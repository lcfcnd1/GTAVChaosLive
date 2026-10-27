using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class TransportDiagnosticHarness
{
    private static async Task<string> ReceiveText(ClientWebSocket socket, CancellationToken stop)
    {
        byte[] buffer = new byte[4096];
        var output = new StringBuilder();
        WebSocketReceiveResult frame;
        do
        {
            frame = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), stop).ConfigureAwait(false);
            if (frame.MessageType == WebSocketMessageType.Close) return null;
            output.Append(Encoding.UTF8.GetString(buffer, 0, frame.Count));
        } while (!frame.EndOfMessage);
        return output.ToString();
    }

    private static Task SendText(ClientWebSocket socket, string value, CancellationToken stop)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        return socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, stop);
    }

    private static async Task<bool> AuthorizedProbe(string endpoint, string token, CancellationToken stop)
    {
        string probeId = "diagnostic-harness-" + Guid.NewGuid().ToString();
        using (var socket = new ClientWebSocket())
        {
            await socket.ConnectAsync(new Uri(endpoint), stop).ConfigureAwait(false);
            await SendText(socket, "{\"protocolVersion\":1,\"type\":\"auth.hello\",\"payload\":{\"token\":\"" + Escape(token) + "\",\"client\":\"gta\",\"source\":\"gta-mod\"}}", stop).ConfigureAwait(false);
            bool authenticated = false;
            while (!authenticated)
            {
                string message = await ReceiveText(socket, stop).ConfigureAwait(false);
                if (message == null) return false;
                authenticated = message.Contains("\"status\":\"accepted\"");
            }
            string diagnostic = "{\"protocolVersion\":1,\"type\":\"transport.diagnostic\",\"payload\":{\"id\":\"" + probeId + "\",\"sentAt\":\"" + DateTime.UtcNow.ToString("o") + "\"}}";
            await SendText(socket, diagnostic, stop).ConfigureAwait(false);
            while (true)
            {
                string message = await ReceiveText(socket, stop).ConfigureAwait(false);
                if (message == null) return false;
                if (message.Contains("\"type\":\"transport.diagnostic.ack\"") && message.Contains("\"id\":\"" + probeId + "\""))
                {
                    Console.WriteLine("AUTHORIZED_PROBE_ACK id=" + probeId);
                    return true;
                }
            }
        }
    }

    private static async Task<bool> UnauthorizedProbe(string endpoint, string token, CancellationToken stop)
    {
        using (var socket = new ClientWebSocket())
        {
            await socket.ConnectAsync(new Uri(endpoint), stop).ConfigureAwait(false);
            await SendText(socket, "{\"protocolVersion\":1,\"type\":\"auth.hello\",\"payload\":{\"token\":\"" + Escape(token) + "\",\"client\":\"dashboard\"}}", stop).ConfigureAwait(false);
            bool authenticated = false;
            while (!authenticated)
            {
                string message = await ReceiveText(socket, stop).ConfigureAwait(false);
                if (message == null) return false;
                authenticated = message.Contains("\"status\":\"accepted\"");
            }
            string probeId = "unauthorized-diagnostic-" + Guid.NewGuid().ToString();
            await SendText(socket, "{\"protocolVersion\":1,\"type\":\"transport.diagnostic\",\"payload\":{\"id\":\"" + probeId + "\",\"sentAt\":\"" + DateTime.UtcNow.ToString("o") + "\"}}", stop).ConfigureAwait(false);
            using (var noAck = new CancellationTokenSource(TimeSpan.FromMilliseconds(750)))
            {
                try
                {
                    while (true)
                    {
                        string message = await ReceiveText(socket, noAck.Token).ConfigureAwait(false);
                        if (message != null && message.Contains("transport.diagnostic.ack")) return false;
                    }
                }
                catch (OperationCanceledException) { }
            }
            Console.WriteLine("UNAUTHORIZED_PROBE_REJECTED");
            return true;
        }
    }

    private static string Escape(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    public static int Main()
    {
        string token = Environment.GetEnvironmentVariable("CHAOS_TOKEN");
        if (String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("CHAOS_TOKEN missing");
        string endpoint = Environment.GetEnvironmentVariable("CHAOS_ENDPOINT") ?? "ws://127.0.0.1:39179";
        using (var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
        {
            bool authorized = AuthorizedProbe(endpoint, token, stop.Token).GetAwaiter().GetResult();
            bool unauthorized = UnauthorizedProbe(endpoint, token, stop.Token).GetAwaiter().GetResult();
            Console.WriteLine("RESULT authorized=" + authorized + " unauthorizedRejected=" + unauthorized);
            return authorized && unauthorized ? 0 : 1;
        }
    }
}
