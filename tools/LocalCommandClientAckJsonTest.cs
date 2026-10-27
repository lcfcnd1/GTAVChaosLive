using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
namespace GtaChaosLive
{
    // Minimal compile-time stand-in for the production request type; SendResult's
    // serializer itself is compiled from the real LocalCommandClient.cs below.
    public sealed class EffectRequest
    {
        public EffectRequest(string id, string effectId, System.Collections.Generic.IDictionary<string, object> parameters, DateTime expiresAtUtc) { }
    }

}

namespace GtaChaosLiveTests
{
    using GtaChaosLive;

    [DataContract]
    internal sealed class ResultEnvelope
    {
        [DataMember(Name = "protocolVersion")] public int ProtocolVersion { get; set; }
        [DataMember(Name = "type")] public string Type { get; set; }
        [DataMember(Name = "payload")] public ResultPayload Payload { get; set; }
    }

    [DataContract]
    internal sealed class ResultPayload
    {
        [DataMember(Name = "id")] public string Id { get; set; }
        [DataMember(Name = "effectId")] public string EffectId { get; set; }
        [DataMember(Name = "status")] public string Status { get; set; }
        [DataMember(Name = "createdAt")] public string CreatedAt { get; set; }
        [DataMember(Name = "error")] public string Error { get; set; }
    }

    internal static class Program
    {
        private static ResultEnvelope Parse(string json)
        {
            using (MemoryStream stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json)))
                return (ResultEnvelope)new DataContractJsonSerializer(typeof(ResultEnvelope)).ReadObject(stream);
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void AssertValid(string status, string error)
        {
            string json = LocalCommandClient.BuildResultJson(
                "id\\\"\\\\\n", "effect\\\"", status, error, "2026-10-25T18:00:00.0000000Z");
            ResultEnvelope message = Parse(json);
            Assert(message.ProtocolVersion == 1, "protocolVersion");
            Assert(message.Type == "result", "type");
            Assert(message.Payload.Id == "id\\\"\\\\\n", "id escaping");
            Assert(message.Payload.EffectId == "effect\\\"", "effectId escaping");
            Assert(message.Payload.Status == status, "status");
            Assert(message.Payload.CreatedAt == "2026-10-25T18:00:00.0000000Z", "createdAt");
            Assert(message.Payload.Error == error, "error");
        }

        public static void Main()
        {
            AssertValid("succeeded", null);
            AssertValid("failed", null);
            AssertValid("failed", "quote \\\" slash \\\\ newline\n");

            // Regression guard for the original defect: the malformed form must not parse.
            string malformed = "{\"protocolVersion\":1,\"type\":\"result\",\"payload\":{" +
                "\"id\":\"id\",\"effectId\":\"player.recover_health\",\"status\":\"succeeded," +
                "\"createdAt\":\"2026-10-25T18:00:00.0000000Z\"}}";
            bool rejected = false;
            try { Parse(malformed); } catch (SerializationException) { rejected = true; }
            Assert(rejected, "missing status quote was accepted");
            Console.WriteLine("LocalCommandClient real serializer ACK JSON tests: PASS");
        }
    }
}
