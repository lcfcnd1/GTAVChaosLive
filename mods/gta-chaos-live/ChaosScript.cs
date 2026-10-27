using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Forms;
using GTA;
using GTA.Math;
using GTA.Native;

namespace GtaChaosLive
{
    /// <summary>Minimal safe entry point. Network transport only enqueues work; natives run here.</summary>
    public sealed class ChaosScript : Script
    {
        private readonly ConcurrentQueue<EffectRequest> pending = new ConcurrentQueue<EffectRequest>();
        private readonly EffectRegistry effects = new EffectRegistry();
        private readonly CancellationTokenSource stop = new CancellationTokenSource();
        private readonly LocalCommandClient transport;
        private int observedPlayerHandle = -1;
        private bool observedPlayerDead;
        private bool hasObservedPlayerState;
        private bool diagnosticProbeKeyDown;

        public ChaosScript()
        {
            Tick += OnTick;
            Aborted += OnAborted;
            KeyDown += OnKeyDown;
            KeyUp += OnKeyUp;
            effects.Register(new RagdollEffect());
            effects.Register(new RecoverHealthEffect());
            effects.Register(new InvincibilityEffect());
            effects.Register(new SuperJumpEffect());
            effects.Register(new SpeedBoostEffect());
            effects.Register(new ChangeWeaponEffect());
            effects.Register(new WantedLevelEffect());
            effects.Register(new ClearWantedEffect());
            effects.Register(new RemoveWeaponsEffect());
            effects.Register(new WeatherEffect());
            effects.Register(new TimeOfDayEffect());
            effects.Register(new SpinVehicleEffect());
            effects.Register(new EngineOffEffect());
            transport = new LocalCommandClient(Enqueue, EmergencyStop, stop.Token, BaseDirectory);
            transport.Start();
        }

        private void OnAborted(object sender, EventArgs args) { EmergencyStop(); stop.Cancel(); }
        private void OnKeyDown(object sender, KeyEventArgs args)
        {
            if (args.KeyCode != Keys.F10 || diagnosticProbeKeyDown) return;
            diagnosticProbeKeyDown = true;
            transport.SendTransportDiagnosticProbe();
        }
        private void OnKeyUp(object sender, KeyEventArgs args)
        {
            if (args.KeyCode == Keys.F10) diagnosticProbeKeyDown = false;
        }
        private void EmergencyStop()
        {
            EffectRequest ignored;
            while (pending.TryDequeue(out ignored)) { }
            effects.CancelAll();
            effects.CleanupAll();
        }

        private void OnTick(object sender, EventArgs args)
        {
            bool playerDead;
            bool playerStateChanged = ObservePlayerState(out playerDead);
            if (playerStateChanged)
            {
                ClearPending();
                effects.CancelAll();
                effects.CleanupAll();
            }
            bool storyMode = IsStoryMode();
            if (!storyMode || playerDead)
            {
                // If the game changes mode unexpectedly, restore temporary state
                // before any effect gets another update tick.
                effects.CancelAll();
                effects.CleanupAll();
            }
            EffectRequest request;
            effects.UpdateAll();
            if (!pending.TryDequeue(out request)) return;
            if (request.ExpiresAtUtc <= DateTime.UtcNow)
            {
                transport.SendResult(request.Id, request.EffectId, "failed", "expired");
                return;
            }
            if (!storyMode || playerDead)
            {
                string reason = playerDead ? "player_state_unavailable" : "story_mode_only";
                Log("Rejected effect: " + reason);
                transport.SendResult(request.Id, request.EffectId, "failed", reason);
                return;
            }
            string error;
            if (!effects.TryExecute(request.EffectId, request.Parameters, out error))
            {
                Log("Rejected effect " + request.EffectId + ": " + error);
                transport.SendResult(request.Id, request.EffectId, "failed", error);
            }
            else
            {
                Log("Executed effect " + request.EffectId);
                transport.SendResult(request.Id, request.EffectId, "succeeded", null);
            }
        }

        public bool Enqueue(EffectRequest request)
        {
            if (stop.IsCancellationRequested || request.ExpiresAtUtc <= DateTime.UtcNow) return false;
            if (request.EffectId.Length > 64) return false;
            if (pending.Count >= 128) return false;
            pending.Enqueue(request);
            return true;
        }

        /// <summary>Manual transport-only probe; it never executes a GTA native or effect.</summary>
        public string RequestTransportDiagnosticProbe() { return transport.SendTransportDiagnosticProbe(); }

        private void ClearPending()
        {
            EffectRequest ignored;
            while (pending.TryDequeue(out ignored)) { }
        }

        private bool ObservePlayerState(out bool playerDead)
        {
            try
            {
                Ped player = Game.Player.Character;
                int handle = player.Handle;
                bool dead = player.IsDead || player.Health <= 0;
                bool changed = hasObservedPlayerState && (handle != observedPlayerHandle || dead != observedPlayerDead);
                observedPlayerHandle = handle;
                observedPlayerDead = dead;
                hasObservedPlayerState = true;
                playerDead = dead;
                return changed;
            }
            catch
            {
                hasObservedPlayerState = false;
                playerDead = true;
                return true;
            }
        }

        private static bool IsStoryMode()
        {
            try
            {
                // These natives are read only and run on the game tick, never on the
                // websocket thread. Reject both active and in-session network states.
                return !Function.Call<bool>(Hash.NETWORK_IS_IN_SESSION) &&
                    !Function.Call<bool>(Hash.NETWORK_IS_SESSION_ACTIVE);
            }
            catch
            {
                // Do not risk applying an effect when the game mode cannot be proven.
                return false;
            }
        }

        private static void Log(string message) { GTA.UI.Notification.PostTicker("~g~GTA Chaos Live~s~ " + message, false, false); }
    }

    public sealed class EffectRequest
    {
        public EffectRequest(string id, string effectId, IDictionary<string, object> parameters, DateTime expiresAtUtc)
        { Id = id; EffectId = effectId; Parameters = parameters; ExpiresAtUtc = expiresAtUtc; }
        public string Id { get; private set; }
        public string EffectId { get; private set; }
        public IDictionary<string, object> Parameters { get; private set; }
        public DateTime ExpiresAtUtc { get; private set; }
    }

    public interface IChaosEffect
    {
        string Id { get; }
        bool Execute(IDictionary<string, object> parameters, out string error);
        void Update();
        void Cancel();
        void Cleanup();
    }

    public sealed class EffectRegistry
    {
        private readonly ConcurrentDictionary<string, IChaosEffect> items = new ConcurrentDictionary<string, IChaosEffect>(StringComparer.OrdinalIgnoreCase);
        public void Register(IChaosEffect effect) { items[effect.Id] = effect; }
        public bool TryExecute(string id, IDictionary<string, object> parameters, out string error)
        {
            IChaosEffect effect;
            if (!items.TryGetValue(id, out effect)) { error = "unknown_effect"; return false; }
            return effect.Execute(parameters, out error);
        }
        public void UpdateAll() { foreach (IChaosEffect effect in items.Values) effect.Update(); }
        public void CancelAll() { foreach (IChaosEffect effect in items.Values) effect.Cancel(); }
        public void CleanupAll() { foreach (IChaosEffect effect in items.Values) effect.Cleanup(); }
    }

    public sealed class RagdollEffect : IChaosEffect
    {
        public string Id { get { return "player.ragdoll"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int duration = 750;
            object raw;
            int requested;
            if (parameters.TryGetValue("durationMs", out raw) && raw is int && Int32.TryParse(raw.ToString(), out requested))
                duration = Math.Min(3000, Math.Max(100, requested));
            Game.Player.Character.Ragdoll(duration);
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class RecoverHealthEffect : IChaosEffect
    {
        public string Id { get { return "player.recover_health"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Ped player = Game.Player.Character;
            player.Health = player.MaxHealth;
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class InvincibilityEffect : IChaosEffect
    {
        private bool previousValue;
        private DateTime expiresAtUtc;
        private bool active;
        public string Id { get { return "player.invincibility"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Ped player = Game.Player.Character;
            if (!active) previousValue = player.IsInvincible;
            int duration = 3000;
            object raw;
            int requested;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requested)) duration = Math.Min(10000, Math.Max(250, requested));
            player.IsInvincible = true;
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            error = null;
            return true;
        }
        public void Update() { if (active && DateTime.UtcNow >= expiresAtUtc) Restore(); }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            Game.Player.Character.IsInvincible = previousValue;
            active = false;
        }
    }

    public sealed class SuperJumpEffect : IChaosEffect
    {
        private DateTime expiresAtUtc;
        private bool active;
        public string Id { get { return "player.super_jump"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int duration = 5000;
            object raw;
            int requested;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requested)) duration = Math.Min(15000, Math.Max(500, requested));
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            error = null;
            return true;
        }
        public void Update()
        {
            if (!active) return;
            if (DateTime.UtcNow >= expiresAtUtc) { active = false; return; }
            Function.Call(Hash.SET_SUPER_JUMP_THIS_FRAME, Game.Player);
        }
        public void Cancel() { active = false; }
        public void Cleanup() { active = false; }
    }

    public sealed class ChangeWeaponEffect : IChaosEffect
    {
        public string Id { get { return "player.change_weapon"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            if (Game.Player.Character.Weapons.Select(WeaponHash.Pistol, false))
            {
                error = null;
                return true;
            }
            error = "weapon_unavailable";
            return false;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class WantedLevelEffect : IChaosEffect
    {
        public string Id { get { return "player.wanted_level"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int level = 2;
            object raw;
            int requested;
            if (parameters.TryGetValue("level", out raw) && Int32.TryParse(raw.ToString(), out requested)) level = Math.Min(5, Math.Max(0, requested));
            Game.Player.WantedLevel = level;
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class SpeedBoostEffect : IChaosEffect
    {
        private DateTime expiresAtUtc;
        private float multiplier;
        private bool active;
        public string Id { get { return "player.speed_boost"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int duration = 5000;
            object raw;
            int requestedDuration;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requestedDuration))
                duration = Math.Min(15000, Math.Max(500, requestedDuration));
            multiplier = 1.25f;
            if (parameters.TryGetValue("multiplier", out raw))
            {
                float requestedMultiplier;
                if (Single.TryParse(raw.ToString(), out requestedMultiplier)) multiplier = Math.Min(1.5f, Math.Max(1.05f, requestedMultiplier));
            }
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            error = null;
            return true;
        }
        public void Update()
        {
            if (!active) return;
            if (DateTime.UtcNow >= expiresAtUtc) { Restore(); return; }
            Function.Call(Hash.SET_RUN_SPRINT_MULTIPLIER_FOR_PLAYER, Game.Player, multiplier);
        }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            Function.Call(Hash.SET_RUN_SPRINT_MULTIPLIER_FOR_PLAYER, Game.Player, 1.0f);
            active = false;
        }
    }

    public sealed class ClearWantedEffect : IChaosEffect
    {
        public string Id { get { return "player.clear_wanted"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Game.Player.WantedLevel = 0;
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class RemoveWeaponsEffect : IChaosEffect
    {
        public string Id { get { return "player.remove_weapons"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Game.Player.Character.Weapons.RemoveAll();
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { }
        public void Cleanup() { }
    }

    public sealed class WeatherEffect : IChaosEffect
    {
        private static readonly Weather[] AllowedWeather = { Weather.Clear, Weather.Clouds, Weather.Overcast, Weather.Raining, Weather.ThunderStorm, Weather.Snowing };
        private Weather previousWeather;
        private Weather requestedWeather;
        private DateTime expiresAtUtc;
        private bool active;
        public string Id { get { return "world.weather"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int index = 3;
            object raw;
            int requestedIndex;
            if (parameters.TryGetValue("weatherIndex", out raw) && Int32.TryParse(raw.ToString(), out requestedIndex)) index = Math.Min(AllowedWeather.Length - 1, Math.Max(0, requestedIndex));
            int duration = 10000;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requestedIndex)) duration = Math.Min(30000, Math.Max(1000, requestedIndex));
            if (!active) previousWeather = World.Weather;
            requestedWeather = AllowedWeather[index];
            World.Weather = requestedWeather;
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            error = null;
            return true;
        }
        public void Update() { if (active && DateTime.UtcNow >= expiresAtUtc) Restore(); }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            World.Weather = previousWeather;
            active = false;
        }
    }

    public sealed class TimeOfDayEffect : IChaosEffect
    {
        private int previousHour;
        private int previousMinute;
        private int previousSecond;
        private int targetHour;
        private int targetMinute;
        private DateTime expiresAtUtc;
        private bool active;
        public string Id { get { return "world.time"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            int duration = 10000;
            int hour = 12;
            int minute = 0;
            object raw;
            int requested;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requested))
                duration = Math.Min(30000, Math.Max(1000, requested));
            if (parameters.TryGetValue("hour", out raw) && Int32.TryParse(raw.ToString(), out requested)) hour = Math.Min(23, Math.Max(0, requested));
            if (parameters.TryGetValue("minute", out raw) && Int32.TryParse(raw.ToString(), out requested)) minute = Math.Min(59, Math.Max(0, requested));
            Restore();
            previousHour = GTA.Chrono.GameClock.Hour;
            previousMinute = GTA.Chrono.GameClock.Minute;
            previousSecond = GTA.Chrono.GameClock.Second;
            targetHour = hour;
            targetMinute = minute;
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            ApplyTarget();
            error = null;
            return true;
        }
        public void Update()
        {
            if (!active) return;
            if (DateTime.UtcNow >= expiresAtUtc) { Restore(); return; }
            ApplyTarget();
        }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            GTA.Chrono.GameClock.Hour = previousHour;
            GTA.Chrono.GameClock.Minute = previousMinute;
            GTA.Chrono.GameClock.Second = previousSecond;
            active = false;
        }
        private void ApplyTarget()
        {
            GTA.Chrono.GameClock.Hour = targetHour;
            GTA.Chrono.GameClock.Minute = targetMinute;
            GTA.Chrono.GameClock.Second = 0;
        }
    }

    public sealed class SpinVehicleEffect : IChaosEffect
    {
        private Vehicle activeVehicle;
        private Vector3 previousRotationVelocity;
        private DateTime expiresAtUtc;
        private float spinRate;
        private bool active;
        public string Id { get { return "vehicle.spin"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Vehicle vehicle = Game.Player.Character.CurrentVehicle;
            if (vehicle == null) { error = "player_not_in_vehicle"; return false; }
            Restore();
            int duration = 5000;
            object raw;
            int requestedDuration;
            if (parameters.TryGetValue("durationMs", out raw) && Int32.TryParse(raw.ToString(), out requestedDuration))
                duration = Math.Min(10000, Math.Max(500, requestedDuration));
            spinRate = 4.0f;
            float requestedRate;
            if (parameters.TryGetValue("spinRate", out raw) && Single.TryParse(raw.ToString(), out requestedRate))
                spinRate = Math.Min(8.0f, Math.Max(1.0f, Math.Abs(requestedRate)));
            activeVehicle = vehicle;
            previousRotationVelocity = vehicle.LocalRotationVelocity;
            expiresAtUtc = DateTime.UtcNow.AddMilliseconds(duration);
            active = true;
            error = null;
            return true;
        }
        public void Update()
        {
            if (!active) return;
            if (DateTime.UtcNow >= expiresAtUtc) { Restore(); return; }
            try { if (activeVehicle != null) activeVehicle.LocalRotationVelocity = new Vector3(0.0f, 0.0f, spinRate); }
            catch { Restore(); }
        }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            try { if (activeVehicle != null) activeVehicle.LocalRotationVelocity = previousRotationVelocity; }
            catch { /* The vehicle may have been removed while the effect was active. */ }
            activeVehicle = null;
            active = false;
        }
    }

    public sealed class EngineOffEffect : IChaosEffect
    {
        private Vehicle activeVehicle;
        private bool previousEngineRunning;
        private bool active;
        public string Id { get { return "vehicle.engine_off"; } }
        public bool Execute(IDictionary<string, object> parameters, out string error)
        {
            Vehicle vehicle = Game.Player.Character.CurrentVehicle;
            if (vehicle == null) { error = "player_not_in_vehicle"; return false; }
            Restore();
            activeVehicle = vehicle;
            previousEngineRunning = vehicle.IsEngineRunning;
            vehicle.IsEngineRunning = false;
            vehicle.IsHandbrakeForcedOn = true;
            active = true;
            error = null;
            return true;
        }
        public void Update() { }
        public void Cancel() { Restore(); }
        public void Cleanup() { Restore(); }
        private void Restore()
        {
            if (!active) return;
            try
            {
                if (activeVehicle != null)
                {
                    activeVehicle.IsEngineRunning = previousEngineRunning;
                    activeVehicle.IsHandbrakeForcedOn = false;
                }
            }
            catch { /* The vehicle may have been removed while the effect was active. */ }
            activeVehicle = null;
            active = false;
        }
    }
}
