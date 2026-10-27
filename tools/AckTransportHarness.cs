using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class AckTransportHarness
{
    private static async Task<int> Run()
    {
        string token = Environment.GetEnvironmentVariable("CHAOS_TOKEN");
        if (String.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("CHAOS_TOKEN missing");
        string id = "transport-csharp-isolation-" + Guid.NewGuid().ToString();
        using (var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
        using (var socket = new ClientWebSocket())
        {
            await socket.ConnectAsync(new Uri("ws://127.0.0.1:39177"), stop.Token).ConfigureAwait(false);
            string auth = "{\"protocolVersion\":1,\"type\":\"auth.hello\",\"payload\":{\"token\":\"" + Escape(token) + "\",\"client\":\"gta\",\"source\":\"gta-mod\"}}";
            await SendText(socket, auth, stop.Token).ConfigureAwait(false);
            Task receiver = ReceiveFrames(socket, stop.Token);
            string result = "{\"protocolVersion\":1,\"type\":\"result\",\"payload\":{" +
                "\"id\":\"" + id + "\",\"effectId\":\"transport.csharp.isolation\",\"status\":\"succeeded\",\"createdAt\":\"" + DateTime.UtcNow.ToString("o") + "\"}}";
            await SendText(socket, result, stop.Token).ConfigureAwait(false);
            Console.WriteLine("HARNESS_SENT id=" + id);
            await Task.Delay(250, stop.Token).ConfigureAwait(false);
            stop.Cancel();
            try { await receiver.ConfigureAwait(false); } catch (OperationCanceledException) { }
        }
        return 0;
    }

    private static async Task ReceiveFrames(ClientWebSocket socket, CancellationToken stop)
    {
        byte[] buffer = new byte[4096];
        while (!stop.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            WebSocketReceiveResult frame = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), stop).ConfigureAwait(false);
            if (frame.MessageType == WebSocketMessageType.Close) return;
        }
    }

    private static Task SendText(ClientWebSocket socket, string value, CancellationToken stop)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        return socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, stop);
    }

    private static string Escape(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\""); }
    public static int Main() { return Run().GetAwaiter().GetResult(); }
}
