using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;

internal static class NativeHost
{
    private static byte[] ReadExactly(Stream stream, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int read = stream.Read(buffer, offset, length - offset);
            if (read == 0) throw new EndOfStreamException("Native request ended early.");
            offset += read;
        }
        return buffer;
    }

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
                var output = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var errors = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                // sendNativeMessage keeps stdin open until the reply; forward one complete frame.
                Stream input = Console.OpenStandardInput();
                byte[] header = ReadExactly(input, 4);
                uint length = BitConverter.ToUInt32(header, 0);
                if (length > 33554432) throw new InvalidDataException("Native request too large.");
                byte[] body = ReadExactly(input, (int)length);
                process.StandardInput.BaseStream.Write(header, 0, header.Length);
                process.StandardInput.BaseStream.Write(body, 0, body.Length);
                process.StandardInput.BaseStream.Flush();
                process.StandardInput.Close();
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
