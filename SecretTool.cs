using System;using System.IO;using System.Security.Cryptography;
class SecretTool {
 static int Main(string[] args){try{if(args.Length!=2)return 2;var file=Path.GetFullPath(args[1]);
  if(args[0]=="--create-key"){if(File.Exists(file))return 3;var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllBytes(file,ProtectedData.Protect(bytes,null,DataProtectionScope.CurrentUser));return 0;}
  if(args[0]!="--read-key"&&args[0]!="--read-token")return 2;
  var encrypted=args[0]=="--read-token"?Convert.FromBase64String(File.ReadAllText(file)):File.ReadAllBytes(file);
  var plain=ProtectedData.Unprotect(encrypted,null,DataProtectionScope.CurrentUser);
  Console.Out.Write(args[0]=="--read-key"?Convert.ToBase64String(plain):System.Text.Encoding.UTF8.GetString(plain));return 0;
 }catch{return 1;}}
}
