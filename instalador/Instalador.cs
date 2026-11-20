// Instalador de Planificador Outlook (sin administrador).
// Lleva la aplicación comprimida dentro (recurso "app.zip"), la copia a
// %LOCALAPPDATA%\Programs\PlanificadorOutlook y luego ejecuta instalar_app.ps1,
// que instala Python, las librerías y crea los accesos directos.
//
// Al actualizar conserva los datos del usuario: catálogo, reglas, etiquetas aprendidas y respaldos.
// Opciones:  /destino:"C:\otra\carpeta"   /sinpausa   /sinaccesos (prueba: sin accesos directos ni registro)
// Se compila con construir.ps1 (usa csc.exe de .NET Framework, que ya viene con Windows).

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

[assembly: AssemblyTitle("Instalador Planificador Outlook")]
[assembly: AssemblyProduct("Planificador Outlook")]
[assembly: AssemblyDescription("Planificador de calendario Outlook y carga a Time Capture")]
[assembly: AssemblyCompany("FredyxD25")]
[assembly: AssemblyCopyright("© 2026 FredyxD25 - https://github.com/FredyxD25/TimeCapture_Automatizacion")]
[assembly: AssemblyVersion("1.0.2.0")]
[assembly: AssemblyFileVersion("1.0.2.0")]

static class Programa
{
    // Archivos que el usuario modifica: si ya existen no se sobrescriben al actualizar
    static readonly string[] DatosUsuario =
    {
        "planificador/catalogo.json",
        "planificador/reglas_etiquetas.json",
        "planificador/etiquetas_aprendidas.json",
    };

    static int Main(string[] args)
    {
        bool pausa = true, accesos = true;
        string destino = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PlanificadorOutlook");
        foreach (string a in args)
        {
            if (a.StartsWith("/destino:", StringComparison.OrdinalIgnoreCase)) destino = a.Substring(9).Trim('"');
            else if (a.Equals("/sinpausa", StringComparison.OrdinalIgnoreCase)) pausa = false;
            else if (a.Equals("/sinaccesos", StringComparison.OrdinalIgnoreCase)) accesos = false;
        }
        destino = Path.GetFullPath(destino);

        int codigo;
        try
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.Title = "Instalador Planificador Outlook";
        }
        catch { }

        try
        {
            Titulo("Planificador Outlook 1.0.2 - instalador (no necesita administrador)");
            Console.WriteLine("Por FredyxD25 · https://github.com/FredyxD25/TimeCapture_Automatizacion");
            Console.WriteLine("Carpeta de instalación: " + destino);

            Paso("Copiando la aplicación");
            Copiar(destino);

            Paso("Instalando Python, librerías y accesos directos");
            string script = Path.Combine(destino, "instalador", "instalar_app.ps1");
            var info = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Destino \"" + destino + "\"" + (accesos ? "" : " -SinAccesos"));
            info.UseShellExecute = false; // misma ventana: se ve el avance
            using (Process p = Process.Start(info))
            {
                p.WaitForExit();
                codigo = p.ExitCode;
            }
            if (codigo != 0) throw new Exception("La instalación de Python o de las librerías falló (código " + codigo + ").");
        }
        catch (Exception e)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("ERROR: " + e.Message);
            Console.ResetColor();
            Console.WriteLine("Revisa tu conexión a internet y vuelve a ejecutar el instalador.");
            codigo = 1;
        }

        if (pausa)
        {
            Console.WriteLine();
            Console.WriteLine("Presiona Enter para cerrar...");
            Console.ReadLine();
        }
        return codigo;
    }

    static void Copiar(string destino)
    {
        Directory.CreateDirectory(destino);
        string raiz = destino.TrimEnd('\\') + "\\";

        // La interfaz compilada cambia de nombres en cada versión: se reemplaza completa
        string dist = Path.Combine(destino, "planificador", "web", "dist");
        if (Directory.Exists(dist)) Directory.Delete(dist, true);

        int copiados = 0, conservados = 0;
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        {
            if (s == null) throw new Exception("El instalador está incompleto (no trae la aplicación).");
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    if (string.IsNullOrEmpty(e.Name)) continue; // carpeta
                    string nombre = e.FullName.Replace('\\', '/');
                    string ruta = Path.GetFullPath(Path.Combine(destino, nombre.Replace('/', '\\')));
                    if (!ruta.StartsWith(raiz, StringComparison.OrdinalIgnoreCase))
                        throw new Exception("Ruta no válida dentro del paquete: " + nombre);

                    if (Array.IndexOf(DatosUsuario, nombre) >= 0 && File.Exists(ruta))
                    {
                        conservados++;
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(ruta));
                    e.ExtractToFile(ruta, true);
                    copiados++;
                }
            }
        }
        Ok(copiados + " archivos copiados" + (conservados > 0 ? " (se conservaron " + conservados + " archivos con tus datos)" : ""));
    }

    static void Titulo(string t)
    {
        Console.ForegroundColor = ConsoleColor.White;
        Console.WriteLine(t);
        Console.WriteLine(new string('=', t.Length));
        Console.ResetColor();
    }

    static void Paso(string t)
    {
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("==> " + t);
        Console.ResetColor();
    }

    static void Ok(string t)
    {
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("    OK  " + t);
        Console.ResetColor();
    }
}
