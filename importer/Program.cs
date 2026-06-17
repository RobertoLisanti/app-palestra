using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

// ============================================================================
//  Palestra importer
//  Legge tutti gli .xlsx delle schede e produce un unico data/schede.json
//  per la PWA. Nessuna dipendenza esterna: lo xlsx e' uno zip + XML.
// ============================================================================

string srcDir = args.Length > 0 ? args[0] : @"C:\Users\rober\OneDrive\Documenti\Palestra";
string outFile = args.Length > 1 ? args[1] : @"C:\Users\rober\OneDrive\Documenti\Claude\app-palestra\data\schede.json";

XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
XNamespace rns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

var weekRe = new Regex(@"^W?\s*([1-9][0-9]?)$", RegexOptions.IgnoreCase);

static string ColOf(string cellRef)
{
    int i = 0;
    while (i < cellRef.Length && char.IsLetter(cellRef[i])) i++;
    return cellRef.Substring(0, i);
}
static int ColNum(string col)
{
    int n = 0;
    foreach (char c in col) n = n * 26 + (char.ToUpperInvariant(c) - 'A' + 1);
    return n;
}
static int RowOf(string cellRef)
{
    int i = 0;
    while (i < cellRef.Length && char.IsLetter(cellRef[i])) i++;
    return int.Parse(cellRef.Substring(i));
}

var schede = new List<object>();

var files = Directory.GetFiles(srcDir, "*.xlsx")
    .Where(f => !Path.GetFileName(f).StartsWith("~$"))
    .OrderBy(f => Path.GetFileNameWithoutExtension(f), new VersionishComparer())
    .ToList();

Console.WriteLine($"Trovati {files.Count} file in {srcDir}");

foreach (var path in files)
{
    string id = Path.GetFileNameWithoutExtension(path);          // es "3.2"
    var parts = id.Split('.');
    int fase = parts.Length > 0 && int.TryParse(parts[0], out var f0) ? f0 : 0;
    int num = parts.Length > 1 && int.TryParse(parts[1], out var n0) ? n0 : 0;
    DateTime date = File.GetLastWriteTime(path);

    using var zip = ZipFile.OpenRead(path);

    // --- shared strings ---
    var shared = new List<string>();
    var ssEntry = zip.GetEntry("xl/sharedStrings.xml");
    if (ssEntry != null)
    {
        using var s = ssEntry.Open();
        var doc = XDocument.Load(s);
        foreach (var si in doc.Root!.Elements(ns + "si"))
        {
            // concatena tutti i nodi <t> (gestisce rich text)
            var text = string.Concat(si.Descendants(ns + "t").Select(t => (string)t));
            shared.Add(text);
        }
    }

    // --- mappa rId -> target file foglio ---
    var rels = new Dictionary<string, string>();
    var relEntry = zip.GetEntry("xl/_rels/workbook.xml.rels");
    if (relEntry != null)
    {
        using var s = relEntry.Open();
        var doc = XDocument.Load(s);
        foreach (var r in doc.Root!.Elements())
        {
            string rid = (string?)r.Attribute("Id") ?? "";
            string tgt = (string?)r.Attribute("Target") ?? "";
            rels[rid] = tgt;
        }
    }

    // --- ordine fogli + nomi ---
    var sheetList = new List<(string name, string target)>();
    using (var s = zip.GetEntry("xl/workbook.xml")!.Open())
    {
        var doc = XDocument.Load(s);
        foreach (var sh in doc.Descendants(ns + "sheet"))
        {
            string name = (string?)sh.Attribute("name") ?? "";
            string rid = (string?)sh.Attribute(rns + "id") ?? "";
            if (rels.TryGetValue(rid, out var tgt))
            {
                if (!tgt.StartsWith("xl/")) tgt = "xl/" + tgt.TrimStart('/');
                sheetList.Add((name, tgt));
            }
        }
    }

    var giorni = new List<object>();

    foreach (var (sheetName, target) in sheetList)
    {
        var entry = zip.GetEntry(target);
        if (entry == null) continue;

        // costruisci griglia: rowNum -> (colNum -> testo)
        var grid = new SortedDictionary<int, SortedDictionary<int, string>>();
        using (var s = entry.Open())
        {
            var doc = XDocument.Load(s);
            foreach (var c in doc.Descendants(ns + "c"))
            {
                string cref = (string?)c.Attribute("r") ?? "";
                if (cref.Length == 0) continue;
                string t = (string?)c.Attribute("t") ?? "";
                string val;
                var v = c.Element(ns + "v");
                if (t == "s")
                {
                    if (v == null) continue;
                    int idx = int.Parse(v.Value);
                    val = idx >= 0 && idx < shared.Count ? shared[idx] : "";
                }
                else if (t == "inlineStr")
                {
                    val = string.Concat(c.Descendants(ns + "t").Select(x => (string)x));
                }
                else
                {
                    val = v?.Value ?? "";
                }
                val = val.Trim();
                if (val.Length == 0) continue;
                int rn = RowOf(cref), cn = ColNum(ColOf(cref));
                if (!grid.TryGetValue(rn, out var rowMap)) { rowMap = new(); grid[rn] = rowMap; }
                rowMap[cn] = val;
            }
        }

        var esercizi = ParseDay(grid, weekRe);
        if (esercizi.Count == 0) continue;
        giorni.Add(new { nome = sheetName, esercizi });
    }

    schede.Add(new
    {
        id,
        fase,
        num,
        titolo = $"Fase {fase} · Scheda {num}",
        data = date.ToString("yyyy-MM-dd"),
        giorni
    });
    Console.WriteLine($"  {id}: {giorni.Count} giorni");
}

var payload = new
{
    generato = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
    correnteId = schede.Count > 0 ? ((dynamic)schede[^1]).id : null,
    schede
};

Directory.CreateDirectory(Path.GetDirectoryName(outFile)!);
var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
{
    WriteIndented = true,
    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
});
File.WriteAllText(outFile, json);
Console.WriteLine($"\nScritto {outFile} ({json.Length} bytes, {schede.Count} schede)");


// ----------------------------------------------------------------------------
//  Parsing di un giorno: state machine guidata da parole chiave + colonna.
// ----------------------------------------------------------------------------
static List<object> ParseDay(SortedDictionary<int, SortedDictionary<int, string>> grid, Regex weekRe)
{
    var esercizi = new List<Ex>();
    Ex? cur = null;
    string mode = "seek";          // seek | name | details | rest | prog
    Week? pendingWeek = null;

    bool IsDettagli(string t) => t.Equals("Dettagli", StringComparison.OrdinalIgnoreCase);
    bool IsRecupero(string t) => t.StartsWith("Recupero", StringComparison.OrdinalIgnoreCase);
    bool IsProg(string t) => t.StartsWith("Progressione", StringComparison.OrdinalIgnoreCase);
    // tempo di recupero: "2:00", "1:30", "1:00 - 1:30" (anche con . al posto di :)
    var timeRe = new Regex(@"^\d{1,2}[:.]\d{2}(\s*[-–]\s*\d{1,2}[:.]\d{2})?$");

    foreach (var (rowNum, rowMap) in grid)
    {
        if (rowMap.Count == 0) continue;
        int firstCol = rowMap.Keys.First();
        string firstText = rowMap[firstCol];

        // --- keyword: una qualsiasi cella della riga ---
        string? recuperoLabelText = rowMap.Values.FirstOrDefault(IsRecupero);
        if (rowMap.Values.Any(IsDettagli)) { mode = "details"; continue; }
        if (recuperoLabelText != null)
        {
            mode = "rest";
            // valore sulla stessa riga? (altra cella diversa dall'etichetta)
            var other = rowMap.Where(kv => !IsRecupero(kv.Value)).Select(kv => kv.Value).FirstOrDefault();
            if (other != null && cur != null) { cur.Rest = other; mode = "after"; }
            continue;
        }
        if (rowMap.Values.Any(IsProg)) { mode = "prog"; pendingWeek = null; continue; }

        // --- recupero implicito (riga isolata tipo "2:00") prima della progressione ---
        if (mode != "prog" && cur != null && string.IsNullOrEmpty(cur.Rest))
        {
            var t = rowMap.Values.FirstOrDefault(v => timeRe.IsMatch(v));
            if (t != null) { cur.Rest = t; continue; }
        }

        // --- etichetta settimana (in colonna B / prima cella) ---
        var wm = weekRe.Match(firstText);
        if (wm.Success && firstCol <= 2 && cur != null)
        {
            // target = prima cella a destra dell'etichetta
            string? target = rowMap.Where(kv => kv.Key > firstCol).Select(kv => kv.Value).FirstOrDefault();
            var wk = new Week { Label = "W" + wm.Groups[1].Value, Target = target, Feedback = null };
            cur.Weeks.Add(wk);
            pendingWeek = wk;
            mode = "prog";
            continue;
        }

        // --- contenuto generico ---
        if (mode == "details")
        {
            if (cur != null && firstCol <= 2) cur.Cues.Add(firstText);
            continue;
        }
        if (mode == "rest")
        {
            if (cur != null) cur.Rest = firstText;
            mode = "after";
            continue;
        }
        if (mode == "prog")
        {
            if (firstCol >= 3)
            {
                // riga di feedback (colonna C+) per la settimana corrente
                if (pendingWeek != null && pendingWeek.Feedback == null) pendingWeek.Feedback = firstText;
                continue;
            }
            // colonna B con testo non-settimana => nuovo esercizio
            cur = new Ex { Name = firstText };
            esercizi.Add(cur);
            mode = "name";
            pendingWeek = null;
            continue;
        }

        // mode seek/name/after => nome esercizio (colonna B)
        if (firstCol <= 2)
        {
            cur = new Ex { Name = firstText };
            esercizi.Add(cur);
            mode = "name";
            pendingWeek = null;
        }
    }

    // scarta blocchi vuoti (titoli/intestazioni catturati per errore)
    var clean = esercizi.Where(e => e.Weeks.Count > 0 || e.Cues.Count > 0).ToList();

    return clean.Select(e => (object)new
    {
        nome = e.Name,
        recupero = e.Rest,
        note = e.Cues,
        settimane = e.Weeks
            .Where(w => !(string.IsNullOrEmpty(w.Target) && string.IsNullOrEmpty(w.Feedback)))
            .Select(w => (object)new { label = w.Label, obiettivo = w.Target, feedback = w.Feedback })
            .ToList()
    }).ToList();
}

sealed class Ex
{
    public string Name = "";
    public string? Rest;
    public List<string> Cues = new();
    public List<Week> Weeks = new();
}
sealed class Week
{
    public string Label = "";
    public string? Target;
    public string? Feedback;
}

// ordina "1.1","1.2",... "3.2" numericamente per fase poi scheda
sealed class VersionishComparer : IComparer<string>
{
    public int Compare(string? x, string? y)
    {
        (int, int) Key(string? s)
        {
            var p = (s ?? "").Split('.');
            int a = p.Length > 0 && int.TryParse(p[0], out var av) ? av : 0;
            int b = p.Length > 1 && int.TryParse(p[1], out var bv) ? bv : 0;
            return (a, b);
        }
        var kx = Key(x); var ky = Key(y);
        int c = kx.Item1.CompareTo(ky.Item1);
        return c != 0 ? c : kx.Item2.CompareTo(ky.Item2);
    }
}
