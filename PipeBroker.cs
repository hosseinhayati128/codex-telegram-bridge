using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

// JSONL transport only. Native decisions/authentication remain in Node.
// Each pipe instance has a protected DACL granting only the current Windows SID.
class PipeBroker {
 static object outputLock=new object();
 static ConcurrentDictionary<string,StreamWriter> clients=new ConcurrentDictionary<string,StreamWriter>();
 static void Emit(string text){lock(outputLock){Console.Out.WriteLine(text);Console.Out.Flush();}}
 static void Main(string[] args){
  if(args.Length!=1||!args[0].StartsWith("CodexTelegramBridge-"))Environment.Exit(2);
  var sid=WindowsIdentity.GetCurrent().User;
  var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);
  security.SetOwner(sid);security.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.FullControl,AccessControlType.Allow));
  new Thread(()=>{try{string line;while((line=Console.In.ReadLine())!=null){if(line.StartsWith("!")){StreamWriter closed;if(clients.TryRemove(line.Substring(1),out closed))try{closed.BaseStream.Close();}catch{}continue;}int split=line.IndexOf('\t');if(split<1)continue;StreamWriter writer;if(!clients.TryGetValue(line.Substring(0,split),out writer))continue;
   try{var text=Encoding.UTF8.GetString(Convert.FromBase64String(line.Substring(split+1)));if(text.IndexOf('\n')>=0)continue;lock(writer){writer.WriteLine(text);writer.Flush();}}catch{}}
  }finally{Environment.Exit(0);}}){IsBackground=true}.Start();
  while(true){
   var pipe=new NamedPipeServerStream(args[0],PipeDirection.InOut,32,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security);
   pipe.WaitForConnection();
   ThreadPool.QueueUserWorkItem(_=>{var id=Guid.NewGuid().ToString("N");StreamWriter writer=null;
    try{writer=new StreamWriter(pipe,new UTF8Encoding(false),65536,true);writer.NewLine="\n";clients[id]=writer;Emit("+"+id);
     using(var reader=new StreamReader(pipe,new UTF8Encoding(false,true),false,65536,true)){string line;while((line=reader.ReadLine())!=null){if(line.Length>16*1024*1024)break;Emit(id+"\t"+Convert.ToBase64String(Encoding.UTF8.GetBytes(line)));}}
    }catch{}finally{StreamWriter removed;clients.TryRemove(id,out removed);Emit("-"+id);if(writer!=null)writer.Dispose();pipe.Dispose();}
   });
  }
 }
}
