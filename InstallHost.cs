using System;using System.IO;using System.Runtime.InteropServices;using System.Security.Principal;using Microsoft.Win32;using System.Security.Cryptography;using System.Text;
class InstallHost {
 static string Fingerprint(string text){using(var hash=SHA256.Create()){return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}}
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr h,uint message,UIntPtr w,string text,uint flags,uint timeout,out UIntPtr result);
 static dynamic Scheduler(){dynamic s=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));s.Connect();return s;}
 static int Main(string[] args){try{
  if(args.Length==0)return 2;
  if(args[0]=="env-get"){var value=Environment.GetEnvironmentVariable("CODEX_CLI_PATH",EnvironmentVariableTarget.User);Console.Write(value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"")+"\"");return 0;}
  if(args[0]=="env-set"&&args.Length==3){string current=Environment.GetEnvironmentVariable("CODEX_CLI_PATH",EnvironmentVariableTarget.User);string expected=args[1]=="--absent"?null:args[1];if(current!=expected)return 4;string desired=args[2]=="--absent"?null:args[2];Environment.SetEnvironmentVariable("CODEX_CLI_PATH",desired,EnvironmentVariableTarget.User);UIntPtr r;SendMessageTimeout(new IntPtr(0xffff),0x1a,UIntPtr.Zero,"Environment",2,3000,out r);return 0;}
  if(args.Length<2||args[1]!="Codex Telegram Bridge")return 2;
  dynamic service=Scheduler(),folder=service.GetFolder("\\");
  if(args[0]=="task-inspect"){try{dynamic t=folder.GetTask(args[1]);Console.Write(t.Xml);}catch(Exception e){if((uint)e.HResult==0x80070002)Console.Write("ABSENT");else throw;}return 0;}
  if(args[0]=="task-register"&&args.Length==3){try{folder.GetTask(args[1]);return 4;}catch(Exception e){if((uint)e.HResult!=0x80070002)throw;}
   var executable=Path.GetFullPath(args[2]);if(!File.Exists(executable)||Path.GetFileName(executable)!="Supervisor.exe")return 2;
   string sid=WindowsIdentity.GetCurrent().User.Value;dynamic task=service.NewTask(0);task.RegistrationInfo.Description="Private current-user Codex Telegram bridge; keeps the paired bot online while signed in.";
   task.Principal.UserId=sid;task.Principal.LogonType=3;task.Principal.RunLevel=0;
   task.Settings.Enabled=true;task.Settings.Hidden=true;task.Settings.StartWhenAvailable=true;task.Settings.DisallowStartIfOnBatteries=false;task.Settings.StopIfGoingOnBatteries=false;task.Settings.ExecutionTimeLimit="PT0S";task.Settings.MultipleInstances=2;task.Settings.RestartCount=999;task.Settings.RestartInterval="PT1M";
   dynamic trigger=task.Triggers.Create(9);trigger.UserId=sid;trigger.Enabled=true;dynamic action=task.Actions.Create(0);action.Path=executable;action.WorkingDirectory=Path.GetDirectoryName(executable);
   folder.RegisterTaskDefinition(args[1],task,2,sid,null,3,null);return 0;
  }
  if(args[0]=="task-start"){dynamic task=folder.GetTask(args[1]);if(args.Length==3&&Fingerprint(Convert.ToString(task.Xml))!=args[2])return 4;task.Run(null);return 0;}
  if(args[0]=="task-state"){Console.Write(Convert.ToInt32(folder.GetTask(args[1]).State));return 0;}
  if(args[0]=="task-update"&&args.Length==4){dynamic currentTask=folder.GetTask(args[1]);if(Fingerprint(Convert.ToString(currentTask.Xml))!=args[3]||Convert.ToInt32(currentTask.Definition.Actions.Count)!=1)return 4;
   var executable=Path.GetFullPath(args[2]);var allowedRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CodexTelegramBridge","releases")+Path.DirectorySeparatorChar;
   if(!executable.StartsWith(allowedRoot,StringComparison.OrdinalIgnoreCase)||Path.GetFileName(executable)!="Supervisor.exe"||!File.Exists(executable))return 2;
   dynamic definition=currentTask.Definition;definition.Actions.Item(1).Path=executable;definition.Actions.Item(1).WorkingDirectory=Path.GetDirectoryName(executable);
   dynamic updated=folder.RegisterTaskDefinition(args[1],definition,4,definition.Principal.UserId,null,3,null);Console.Write(Convert.ToString(updated.Xml));return 0;
  }
  if(args[0]=="task-delete"&&args.Length==4){dynamic task=folder.GetTask(args[1]);if(Convert.ToString(task.Definition.Actions.Item(1).Path)!=args[2]||Fingerprint(Convert.ToString(task.Xml))!=args[3])return 4;task.Stop(0);folder.DeleteTask(args[1],0);return 0;}
  return 2;
 }catch{Console.Error.Write("Current-user installation action failed; no credentials were logged.");return 1;}}
}
