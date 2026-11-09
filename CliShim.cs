using System;using System.Diagnostics;using System.IO;using System.Text;using System.Threading.Tasks;using System.Runtime.InteropServices;
class CliShim {
 static async Task Pump(Stream input,Stream output){var buffer=new byte[65536];int count;while((count=await input.ReadAsync(buffer,0,buffer.Length))>0){await output.WriteAsync(buffer,0,count);await output.FlushAsync();}}
 [StructLayout(LayoutKind.Sequential)]struct BasicInfo{public IntPtr Reserved1,PebBaseAddress,Reserved2a,Reserved2b,ProcessId,ParentId;}
 [DllImport("ntdll.dll")]static extern int NtQueryInformationProcess(IntPtr handle,int type,ref BasicInfo info,int size,out int length);
 static string VendorPath(string saved){try{var b=new BasicInfo();int length;if(NtQueryInformationProcess(Process.GetCurrentProcess().Handle,0,ref b,Marshal.SizeOf(b),out length)==0){var parent=Process.GetProcessById(b.ParentId.ToInt32()).MainModule.FileName;var directory=Path.GetDirectoryName(parent);if(parent.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)+"\\WindowsApps\\OpenAI.Codex_",StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(parent).Equals("ChatGPT.exe",StringComparison.OrdinalIgnoreCase)){var candidate=Path.Combine(directory,"resources","codex.exe");if(File.Exists(candidate))return candidate;}}}catch{}return saved;}
 internal static string Quote(string arg){var b=new StringBuilder("\"");int slashes=0;foreach(char c in arg){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}b.Append('\\',slashes*2);b.Append('"');return b.ToString();}
 static int Main(string[] args){try{var root=AppDomain.CurrentDomain.BaseDirectory;var paths=File.ReadAllLines(Path.Combine(root,"launcher.ini"));var p=new ProcessStartInfo();p.UseShellExecute=false;p.CreateNoWindow=true;
   bool relay=Array.IndexOf(args,"app-server")>=0;
   var vendor=VendorPath(paths[1]);p.EnvironmentVariables["CODEX_TELEGRAM_REAL_CLI"]=vendor;
   p.FileName=relay?paths[0]:vendor;var argv=new StringBuilder();if(relay)argv.Append(Quote(Path.Combine(root,"stdio-relay.mjs"))).Append(' ');foreach(var a in args)argv.Append(Quote(a)).Append(' ');p.Arguments=argv.ToString();
   // Clear only claims that the desktop itself clears for CODEX_CLI_PATH.
   p.EnvironmentVariables.Remove("CODEX_WINDOWS_REGISTERED_CORE");p.EnvironmentVariables.Remove("CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY");
   p.RedirectStandardInput=true;p.RedirectStandardOutput=true;p.RedirectStandardError=true;
   using(var child=Process.Start(p)){
    var input=Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream).ContinueWith(_=>{try{child.StandardInput.Close();}catch{}});
    var output=Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());var error=Pump(child.StandardError.BaseStream,Console.OpenStandardError());
    child.WaitForExit();Task.WaitAll(new[]{output,error},5000);return child.ExitCode;
   }
  }catch{Console.Error.WriteLine("Codex Telegram launcher failed; use the supplied rollback launcher.");return 1;}}
}
