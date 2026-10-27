using System;
using System.Collections.Generic;

namespace GtaChaosLive
{
    [System.Runtime.Serialization.DataContract]
    internal sealed class WireEffectParameters
    {
        [System.Runtime.Serialization.DataMember(Name = "durationMs")]
        public int? durationMs { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "level")]
        public int? level { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "weatherIndex")]
        public int? weatherIndex { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "multiplier")]
        public double? multiplier { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "spinRate")]
        public double? spinRate { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "hour")]
        public int? hour { get; set; }
        [System.Runtime.Serialization.DataMember(Name = "minute")]
        public int? minute { get; set; }
    }

    internal static class EffectParameterParser
    {
        internal const int MinDurationMs = 1;
        internal const int MaxDurationMs = 60000;
        internal const int MinLevel = 0;
        internal const int MaxLevel = 5;
        internal const int MinWeatherIndex = 0;
        internal const int MaxWeatherIndex = 5;
        internal const double MinMultiplier = 1.05;
        internal const double MaxMultiplier = 1.5;
        internal const double MinSpinRate = 1.0;
        internal const double MaxSpinRate = 8.0;
        internal const int MinHour = 0;
        internal const int MaxHour = 23;
        internal const int MinMinute = 0;
        internal const int MaxMinute = 59;

        internal static bool TryBuild(WireEffectParameters input, out Dictionary<string, object> values, out string error)
        {
            values = new Dictionary<string, object>();
            error = null;
            if (input == null) return true;

            if (!TryAddInt(input.durationMs, "durationMs", MinDurationMs, MaxDurationMs, values, out error)) return false;
            if (!TryAddInt(input.level, "level", MinLevel, MaxLevel, values, out error)) return false;
            if (!TryAddInt(input.weatherIndex, "weatherIndex", MinWeatherIndex, MaxWeatherIndex, values, out error)) return false;
            if (!TryAddDouble(input.multiplier, "multiplier", MinMultiplier, MaxMultiplier, values, out error)) return false;
            if (!TryAddDouble(input.spinRate, "spinRate", MinSpinRate, MaxSpinRate, values, out error)) return false;
            if (!TryAddInt(input.hour, "hour", MinHour, MaxHour, values, out error)) return false;
            if (!TryAddInt(input.minute, "minute", MinMinute, MaxMinute, values, out error)) return false;
            return true;
        }

        private static bool TryAddInt(int? value, string name, int minimum, int maximum, Dictionary<string, object> values, out string error)
        {
            error = null;
            if (!value.HasValue) return true;
            if (value.Value < minimum || value.Value > maximum)
            {
                error = "invalid_" + name;
                return false;
            }
            values[name] = value.Value;
            return true;
        }

        private static bool TryAddDouble(double? value, string name, double minimum, double maximum, Dictionary<string, object> values, out string error)
        {
            error = null;
            if (!value.HasValue) return true;
            if (Double.IsNaN(value.Value) || Double.IsInfinity(value.Value) || value.Value < minimum || value.Value > maximum)
            {
                error = "invalid_" + name;
                return false;
            }
            values[name] = value.Value;
            return true;
        }
    }
}
