using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;
using GtaChaosLive;

internal static class LocalCommandClientParameterSmoke
{
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Main()
    {
        Dictionary<string, object> values;
        string error;
        bool accepted = EffectParameterParser.TryBuild(new WireEffectParameters {
            durationMs = 60000, level = 5, weatherIndex = 5, multiplier = 1.5,
            spinRate = 8.0, hour = 23, minute = 59
        }, out values, out error);
        Assert(accepted && error == null && values.Count == 7, "valid_parameter_set");
        Assert((int)values["durationMs"] == 60000, "durationMs_not_preserved");
        Assert(Math.Abs((double)values["multiplier"] - 1.5) < 0.0001, "multiplier_not_preserved");
        Assert(Math.Abs((double)values["spinRate"] - 8.0) < 0.0001, "spinRate_not_preserved");
        Assert((int)values["hour"] == 23 && (int)values["minute"] == 59, "time_not_preserved");

        Assert(!EffectParameterParser.TryBuild(new WireEffectParameters { multiplier = 1.0 }, out values, out error) && error == "invalid_multiplier", "multiplier_lower_bound");
        Assert(!EffectParameterParser.TryBuild(new WireEffectParameters { spinRate = 8.1 }, out values, out error) && error == "invalid_spinRate", "spinRate_upper_bound");
        Assert(!EffectParameterParser.TryBuild(new WireEffectParameters { hour = 24 }, out values, out error) && error == "invalid_hour", "hour_upper_bound");
        Assert(!EffectParameterParser.TryBuild(new WireEffectParameters { minute = -1 }, out values, out error) && error == "invalid_minute", "minute_lower_bound");
        Assert(!EffectParameterParser.TryBuild(new WireEffectParameters { durationMs = 0 }, out values, out error) && error == "invalid_durationMs", "duration_lower_bound");

        Assert(EffectParameterParser.TryBuild(null, out values, out error) && values.Count == 0, "missing_parameters_should_be_allowed");

        var serializer = new DataContractJsonSerializer(typeof(WireEffectParameters));
        WireEffectParameters decoded;
        using (var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"durationMs\":1234,\"multiplier\":1.25,\"spinRate\":3.5,\"hour\":7,\"minute\":42}")))
        {
            decoded = (WireEffectParameters)serializer.ReadObject(stream);
        }
        Assert(decoded.durationMs == 1234 && Math.Abs(decoded.multiplier.Value - 1.25) < 0.0001, "json_duration_or_multiplier");
        Assert(Math.Abs(decoded.spinRate.Value - 3.5) < 0.0001 && decoded.hour == 7 && decoded.minute == 42, "json_spin_or_time");
        Console.WriteLine("LocalCommandClient parameter smoke: passed");
    }
}
