using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;

internal static class NativeHost
{
    private static int Main()
    {
        try
        {
            string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" +
                    Path.Combine(directory, "Updater.ps1") + "\"",
                WorkingDirectory = directory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(info))
            {
                var input = Console.OpenStandardInput().CopyToAsync(process.StandardInput.BaseStream)
                    .ContinueWith(task => { try { process.StandardInput.Close(); } catch { } });
                var output = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var errors = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                process.WaitForExit();
                Task.WaitAll(output, errors);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Maker updater launcher failed: " + error.Message);
            return 1;
        }
    }
}
