using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace GtaChaosLive
{
    /// <summary>Network boundary for the mod. It never touches GTA natives.</summary>
    internal sealed class LocalCommandClient
    {
        private const int MaxMessageBytes = 64 * 1024;
        private readonly Func<EffectRequest, bool> enqueue;
        private readonly Action emergencyStop;
        private readonly CancellationToken stop;
        private readonly ConcurrentQueue<string> outbox = new ConcurrentQueue<string>();
        private readonly ConcurrentDictionary<string, byte> pendingProbes = new ConcurrentDictionary<string, byte>();
        private readonly string token;
        private readonly string baseDirectory;
        private volatile bool authAccepted;
        private volatile string activeSessionId;

        public LocalCommandClient(Func<EffectRequest, bool> enqueue, Action emergencyStop, CancellationToken stop, string baseDirectory) { this.enqueue = enqueue; this.emergencyStop = emergencyStop; this.stop = stop; this.baseDirectory = baseDirectory; this.token = ReadToken(); Diagnostics.Write(baseDirectory, "client.created"); }
        public void Start()
        {
            // Fail closed when the mod was copied without the installer-issued token.
            if (String.IsNullOrWhiteSpace(token)) { Diagnostics.Write(baseDirectory, "token.missing"); return; }
            Diagnostics.Write(baseDirectory, "token.loaded length=" + token.Length);
            Diagnostics.Write(baseDirectory, "client.start");
            Task.Factory.StartNew<Task>((Func<Task>)ReceiveLoop, stop, TaskCreationOptions.DenyChildAttach, TaskScheduler.Default).Unwrap();
        }

        public void SendResult(string id, string effectId, string status, string error)
        {
            Diagnostics.Write(baseDirectory, "result.queued id=" + id + " status=" + status);
            outbox.Enqueue(BuildResultJson(id, effectId, status, error, DateTime.UtcNow.ToString("o")));
        }

        // Kept separate so the regression harness exercises the exact production serializer.
        internal static string BuildResultJson(string id, string effectId, string status, string error, string createdAt)
        {
            return Serialize(new ResultEnvelope
            {
                ProtocolVersion = 1,
                Type = "result",
                Payload = new ResultPayload
                {
                    Id = id,
                    EffectId = effectId,
                    Status = status,
                    CreatedAt = createdAt,
                    Error = error
                }
            });
        }

        public string SendTransportDiagnosticProbe()
        {
            if (!authAccepted)
            {
                Diagnostics.Write(baseDirectory, "transport.diagnostic.rejected reason=auth_not_accepted session=" + (activeSessionId ?? "none"));
                return null;
            }
            string probeId = Guid.NewGuid().ToString();
            string json = "{\"protocolVersion\":1,\"type\":\"transport.diagnostic\",\"payload\":{" +
                "\"id\":\"" + Escape(probeId) + "\",\"sentAt\":\"" + DateTime.UtcNow.ToString("o") + "\"}}";
            pendingProbes.TryAdd(probeId, 0);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            Diagnostics.Write(baseDirectory, "transport.diagnostic.queued session=" + (activeSessionId ?? "none") + " probeId=" + probeId + " bytes=" + bytes.Length + " sha256=" + Sha256(bytes));
            outbox.Enqueue(json);
            return probeId;
        }

        private async Task ReceiveLoop()
        {
            while (!stop.IsCancellationRequested)
            {
                string sessionId = Guid.NewGuid().ToString("N");
                authAccepted = false;
                activeSessionId = sessionId;
                using (ClientWebSocket socket = new ClientWebSocket())
                using (CancellationTokenSource sessionStop = CancellationTokenSource.CreateLinkedTokenSource(stop))
                {
                    Diagnostics.Write(baseDirectory, "socket.session.created session=" + sessionId);
                    try
                    {
                        Diagnostics.Write(baseDirectory, "connection.attempted session=" + sessionId + " endpoint=127.0.0.1:39177");
                        await socket.ConnectAsync(new Uri("ws://127.0.0.1:39177"), sessionStop.Token).ConfigureAwait(false);
                        Diagnostics.Write(baseDirectory, "websocket.connected session=" + sessionId);
                        byte[] auth = Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"type\":\"auth.hello\",\"payload\":{\"token\":\"" + Escape(token) + "\",\"client\":\"gta\",\"source\":\"gta-mod\"}}");
                        ConcurrentQueue<string> sessionOutbox = new ConcurrentQueue<string>();
                        sessionOutbox.Enqueue(Encoding.UTF8.GetString(auth));
                        Task receive = ReceiveCommands(socket, sessionStop.Token, sessionId);
                        Task send = FlushLoop(socket, sessionOutbox, sessionStop.Token, sessionId);
                        Task completed = await Task.WhenAny(receive, send).ConfigureAwait(false);
                        Diagnostics.Write(baseDirectory, "socket.task.completed session=" + sessionId + " task=" + (completed == receive ? "receive" : "send"));
                        sessionStop.Cancel();
                        Diagnostics.Write(baseDirectory, "socket.sibling.cancelled session=" + sessionId);
                        await ObserveTask(receive, "receive", sessionId).ConfigureAwait(false);
                        await ObserveTask(send, "send", sessionId).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        if (stop.IsCancellationRequested) return;
                    }
                    catch (Exception error)
                    {
                        Diagnostics.Write(baseDirectory, "connection.failed session=" + sessionId + " type=" + error.GetType().FullName);
                        Diagnostics.Write(baseDirectory, "reconnect.scheduled session=" + sessionId + " delayMs=1000");
                        try { Task.Delay(1000, stop).Wait(); } catch { return; }
                    }
                    finally { Diagnostics.Write(baseDirectory, "socket.session.closed session=" + sessionId + " state=" + socket.State); }
                }
                activeSessionId = null;
            }
        }

        private async Task ObserveTask(Task task, string name, string sessionId)
        {
            try { await task.ConfigureAwait(false); Diagnostics.Write(baseDirectory, "socket.sibling.observed session=" + sessionId + " task=" + name + " status=completed"); }
            catch (OperationCanceledException) { Diagnostics.Write(baseDirectory, "socket.sibling.observed session=" + sessionId + " task=" + name + " status=cancelled"); }
            catch (Exception error) { Diagnostics.Write(baseDirectory, "socket.sibling.observed session=" + sessionId + " task=" + name + " status=failed type=" + error.GetType().FullName); }
        }

        private async Task ReceiveCommands(ClientWebSocket socket, CancellationToken sessionStop, string sessionId)
        {
            while (socket.State == WebSocketState.Open && !sessionStop.IsCancellationRequested)
            {
                string message = await ReceiveText(socket, sessionStop).ConfigureAwait(false);
                if (message == null) return;
                WireEnvelope command;
                try
                {
                    command = Deserialize<WireEnvelope>(message);
                }
                catch
                {
                    // A malformed frame must not tear down an otherwise healthy session.
                    continue;
                }
                if (command == null || command.ProtocolVersion != 1) continue;
                if (command.Type == "transport.diagnostic.ack" && command.Payload != null)
                {
                    byte ignored;
                    if (pendingProbes.TryRemove(command.Payload.Id, out ignored))
                        Diagnostics.Write(baseDirectory, "transport.diagnostic.ack session=" + sessionId + " probeId=" + command.Payload.Id + " connectionId=" + command.Payload.ConnectionId);
                    else
                        Diagnostics.Write(baseDirectory, "transport.diagnostic.ack.unmatched session=" + sessionId + " probeId=" + command.Payload.Id + " connectionId=" + command.Payload.ConnectionId);
                    continue;
                }
                if (command.Type == "result" && command.Payload != null)
                {
                    if (String.Equals(command.Payload.Status, "accepted", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!authAccepted) { authAccepted = true; Diagnostics.Write(baseDirectory, "auth.accepted"); }
                        else Diagnostics.Write(baseDirectory, "command.accepted id=" + command.Payload.Id);
                    }
                    else if (!String.IsNullOrWhiteSpace(command.Payload.Error) && !authAccepted)
                        Diagnostics.Write(baseDirectory, "auth.rejected reason=" + command.Payload.Error);
                    continue;
                }
                if (command.Type == "system.stop") { emergencyStop(); continue; }
                if (command.Type != "effect.command" || command.Payload == null) continue;
                if (String.IsNullOrWhiteSpace(command.Payload.Id) || String.IsNullOrWhiteSpace(command.Payload.EffectId) || command.Payload.EffectId.Length > 64) continue;
                DateTime expiresAt;
                if (!DateTime.TryParse(command.Payload.ExpiresAt, out expiresAt))
                {
                    SendResult(command.Payload.Id, command.Payload.EffectId, "failed", "invalid_expiry");
                    continue;
                }
                Dictionary<string, object> parameters;
                string parameterError;
                if (!EffectParameterParser.TryBuild(command.Payload.Parameters, out parameters, out parameterError))
                {
                    SendResult(command.Payload.Id, command.Payload.EffectId, "failed", parameterError);
                    continue;
                }
                if (!enqueue(new EffectRequest(command.Payload.Id, command.Payload.EffectId, parameters, expiresAt.ToUniversalTime())))
                    SendResult(command.Payload.Id, command.Payload.EffectId, "failed", "mod_queue_full");
            }
        }

        private async Task FlushLoop(ClientWebSocket socket, ConcurrentQueue<string> sessionOutbox, CancellationToken sessionStop, string sessionId)
        {
            bool authSent = false;
            while (socket.State == WebSocketState.Open && !sessionStop.IsCancellationRequested)
            {
                string item;
                while (sessionOutbox.TryDequeue(out item) || (authSent && outbox.TryDequeue(out item)))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(item);
                    Diagnostics.Write(baseDirectory, "socket.state.before_send session=" + sessionId + " state=" + socket.State);
                    await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sessionStop).ConfigureAwait(false);
                    Diagnostics.Write(baseDirectory, "socket.state.after_send session=" + sessionId + " state=" + socket.State);
                    Diagnostics.Write(baseDirectory, "result.frame.length session=" + sessionId + " bytes=" + bytes.Length);
                    Diagnostics.Write(baseDirectory, "result.frame.sha256 session=" + sessionId + " sha256=" + Sha256(bytes));
                    if (!authSent) { authSent = true; Diagnostics.Write(baseDirectory, "auth.sent session=" + sessionId + " client=gta source=gta-mod"); }
                }
                await Task.Delay(50, sessionStop).ConfigureAwait(false);
            }
        }

        private static async Task<string> ReceiveText(ClientWebSocket socket, CancellationToken sessionStop)
        {
            byte[] buffer = new byte[8192];
            using (MemoryStream output = new MemoryStream())
            {
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), sessionStop).ConfigureAwait(false);
                    output.Write(buffer, 0, result.Count);
                    if (output.Length > MaxMessageBytes) throw new InvalidDataException("message_too_large");
                }
                while (!result.EndOfMessage);
                return result.MessageType == WebSocketMessageType.Close ? null : Encoding.UTF8.GetString(output.ToArray());
            }
        }

        private static T Deserialize<T>(string value) where T : class
        { using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(value))) return new DataContractJsonSerializer(typeof(T)).ReadObject(stream) as T; }
        private static string Serialize<T>(T value)
        {
            using (MemoryStream stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        private static string Escape(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\""); }
        private static string Sha256(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
            {
                byte[] digest = hash.ComputeHash(bytes);
                StringBuilder text = new StringBuilder(digest.Length * 2);
                foreach (byte value in digest) text.Append(value.ToString("x2"));
                return text.ToString();
            }
        }
        private static class Diagnostics
        {
            private static readonly object Gate = new object();
            public static void Write(string directory, string message)
            {
                if (String.IsNullOrEmpty(directory)) throw new InvalidOperationException("script_base_directory_missing");
                string path = Path.Combine(directory, "GtaChaosLive-transport.log");
                lock (Gate) File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
            }
        }
        private string ReadToken()
        {
            string environment = Environment.GetEnvironmentVariable("CHAOS_TOKEN");
            if (!String.IsNullOrWhiteSpace(environment)) return environment.Trim();
            try
            {
                string directory = baseDirectory;
                if (!String.IsNullOrEmpty(directory))
                {
                    string path = Path.Combine(directory, "gta-chaos-live.token");
                    if (File.Exists(path))
                    {
                        string fileToken = File.ReadAllText(path).Trim();
                        if (!String.IsNullOrWhiteSpace(fileToken)) return fileToken;
                    }
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("GtaChaosLive token read failed: " + error.GetType().FullName);
                throw;
            }
            return null;
        }

        [DataContract]
        private sealed class WireEnvelope
        {
            [DataMember(Name = "protocolVersion")] public int ProtocolVersion { get; set; }
            [DataMember(Name = "type")] public string Type { get; set; }
            [DataMember(Name = "payload")] public WirePayload Payload { get; set; }
        }
        [DataContract]
        private sealed class WirePayload
        {
            [DataMember(Name = "id")] public string Id { get; set; }
            [DataMember(Name = "effectId")] public string EffectId { get; set; }
            [DataMember(Name = "expiresAt")] public string ExpiresAt { get; set; }
            [DataMember(Name = "parameters")] public WireEffectParameters Parameters { get; set; }
            [DataMember(Name = "status")] public string Status { get; set; }
            [DataMember(Name = "error")] public string Error { get; set; }
            [DataMember(Name = "connectionId")] public string ConnectionId { get; set; }
        }
        [DataContract]
        private sealed class ResultEnvelope
        {
            [DataMember(Name = "protocolVersion", Order = 1)] public int ProtocolVersion { get; set; }
            [DataMember(Name = "type", Order = 2)] public string Type { get; set; }
            [DataMember(Name = "payload", Order = 3)] public ResultPayload Payload { get; set; }
        }
        [DataContract]
        private sealed class ResultPayload
        {
            [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
            [DataMember(Name = "effectId", Order = 2)] public string EffectId { get; set; }
            [DataMember(Name = "status", Order = 3)] public string Status { get; set; }
            [DataMember(Name = "createdAt", Order = 4)] public string CreatedAt { get; set; }
            [DataMember(Name = "error", Order = 5, EmitDefaultValue = false)] public string Error { get; set; }
        }
    }
}
