using System;using System.Diagnostics;using System.IO;using System.Runtime.InteropServices;using System.Security.Principal;using System.Text;using System.Threading;using Microsoft.Win32;
class Supervisor {
 [StructLayout(LayoutKind.Sequential)]struct BasicLimit {public long PerProcessUserTime,PerJobUserTime;public uint LimitFlags;public UIntPtr MinWorkingSet,MaxWorkingSet;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)]struct IoCounters {public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)]struct ExtendedLimit {public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemory,PeakJobMemory;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll")]static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll")]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 static string Quote(string arg){return "\""+arg.Replace("\"","\\\"")+"\"";}
 static void Proxy(ProcessStartInfo p){if(!String.IsNullOrEmpty(p.EnvironmentVariables["HTTPS_PROXY"]))return;try{using(var k=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings")){if(Convert.ToInt32(k.GetValue("ProxyEnable",0))!=1)return;var value=Convert.ToString(k.GetValue("ProxyServer",""));var proxy=value;if(value.Contains("=")){proxy=null;foreach(var part in value.Split(';')){var pair=part.Split('=');if(pair.Length==2&&(pair[0]=="https"||pair[0]=="http"&&proxy==null))proxy=pair[1];}}Uri uri;if(proxy!=null&&Uri.TryCreate(proxy.Contains("://")?proxy:"http://"+proxy,UriKind.Absolute,out uri)&&String.IsNullOrEmpty(uri.UserInfo)){p.EnvironmentVariables["HTTPS_PROXY"]=uri.ToString();p.EnvironmentVariables["HTTP_PROXY"]=uri.ToString();p.EnvironmentVariables["NO_PROXY"]="localhost,127.0.0.1,::1";}}}catch{}}
 static int Main(){string state=null;try{var root=AppDomain.CurrentDomain.BaseDirectory;var settings=File.ReadAllLines(Path.Combine(root,"supervisor.ini"));state=settings[1];Directory.CreateDirectory(Path.Combine(state,"private"));
  bool created;using(var mutex=new Mutex(true,"Local\\CodexTelegramBridge-"+WindowsIdentity.GetCurrent().User.Value,out created)){if(!created)return 0;int backoff=1000;
   while(!File.Exists(Path.Combine(state,"private","STOP"))){IntPtr job=IntPtr.Zero;using(var child=new Process()){
    try{job=CreateJobObject(IntPtr.Zero,null);var limits=new ExtendedLimit();limits.Basic.LimitFlags=0x2000;if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new Exception();
     child.StartInfo=new ProcessStartInfo(settings[0],"--use-env-proxy "+Quote(Path.Combine(root,"daemon.mjs")));child.StartInfo.UseShellExecute=false;child.StartInfo.CreateNoWindow=true;child.StartInfo.WorkingDirectory=root;child.StartInfo.RedirectStandardInput=true;child.StartInfo.RedirectStandardOutput=true;child.StartInfo.RedirectStandardError=true;child.StartInfo.EnvironmentVariables["CODEX_TELEGRAM_SUPERVISED"]="1";Proxy(child.StartInfo);
     child.Start();if(!AssignProcessToJobObject(job,child.Handle)){try{child.Kill();}catch{}throw new Exception();}
     child.BeginOutputReadLine();child.BeginErrorReadLine();child.StandardInput.WriteLine("GO");child.StandardInput.Flush();var started=DateTime.UtcNow;
     while(!child.WaitForExit(2000)){
      var health=Path.Combine(state,"private","health.json");if(File.Exists(Path.Combine(state,"private","STOP")))break;
      if((DateTime.UtcNow-started).TotalSeconds>120&&(!File.Exists(health)||(DateTime.UtcNow-File.GetLastWriteTimeUtc(health)).TotalSeconds>90))break;
     }
     if((DateTime.UtcNow-started).TotalMinutes>2)backoff=1000;
    }catch{}finally{if(job!=IntPtr.Zero)CloseHandle(job);}
   }
   if(File.Exists(Path.Combine(state,"private","STOP")))return 0;Thread.Sleep(backoff);backoff=Math.Min(30000,backoff*2);
   }
  }return 0;
 }catch{return 1;}}
}
