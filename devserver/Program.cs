using System.Net;
using System.Text;

// mini static file server per il test locale della PWA
string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
int port = args.Length > 0 && int.TryParse(args[0], out var p) ? p : 5500;

var mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    [".html"] = "text/html; charset=utf-8",
    [".css"] = "text/css; charset=utf-8",
    [".js"] = "text/javascript; charset=utf-8",
    [".json"] = "application/json; charset=utf-8",
    [".webmanifest"] = "application/manifest+json; charset=utf-8",
    [".svg"] = "image/svg+xml",
    [".png"] = "image/png",
    [".ico"] = "image/x-icon",
};

var listener = new HttpListener();
listener.Prefixes.Add($"http://localhost:{port}/");
listener.Start();
Console.WriteLine($"Serving {root} on http://localhost:{port}/");

while (true)
{
    var ctx = await listener.GetContextAsync();
    _ = Task.Run(() =>
    {
        try
        {
            string path = Uri.UnescapeDataString(ctx.Request.Url!.AbsolutePath).TrimStart('/');
            if (string.IsNullOrEmpty(path)) path = "index.html";
            string full = Path.GetFullPath(Path.Combine(root, path));
            if (!full.StartsWith(root) || !File.Exists(full))
            {
                ctx.Response.StatusCode = 404;
                var nf = Encoding.UTF8.GetBytes("404");
                ctx.Response.OutputStream.Write(nf); ctx.Response.Close(); return;
            }
            ctx.Response.ContentType = mime.TryGetValue(Path.GetExtension(full), out var m) ? m : "application/octet-stream";
            ctx.Response.Headers["Cache-Control"] = "no-store";
            var bytes = File.ReadAllBytes(full);
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes);
            ctx.Response.Close();
        }
        catch { try { ctx.Response.Abort(); } catch { } }
    });
}
