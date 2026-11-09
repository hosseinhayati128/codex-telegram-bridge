using System;using System.Collections.Generic;using System.Web.Script.Serialization;
class NativeFixture {
 static void Output(string s){Console.WriteLine(s);Console.Out.Flush();}
 static void Main(){var json=new JavaScriptSerializer();int count=0;string line;while((line=Console.ReadLine())!=null){var m=json.Deserialize<Dictionary<string,object>>(line);
  if(m.ContainsKey("method")&&Convert.ToString(m["method"])=="initialize"){
   Output("{\"id\":1,\"result\":{}}");
   Output("{\"id\":9007199254740993,\"method\":\"item/tool/requestUserInput\",\"params\":{\"threadId\":\"fixture-chat\",\"turnId\":\"turn\",\"itemId\":\"q\",\"isBlocking\":true,\"questions\":[{\"id\":\"q\",\"header\":\"Test\",\"question\":\"Which?\"}]}}");
   Output("{\"id\":\"cmd\",\"method\":\"item/commandExecution/requestApproval\",\"params\":{\"threadId\":\"fixture-chat\",\"turnId\":\"turn\",\"itemId\":\"c\",\"startedAtMs\":1,\"kind\":\"humanCommand\",\"command\":\"Write-Output fixture\",\"availableDecisions\":[\"accept\",\"decline\",\"cancel\"]}}");
   Output("{\"method\":\"item/started\",\"params\":{\"threadId\":\"fixture-chat\",\"turnId\":\"turn\",\"item\":{\"id\":\"f\",\"type\":\"fileChange\",\"changes\":[{\"path\":\"fixture.txt\",\"kind\":{\"type\":\"add\"},\"diff\":\"+fixture\"}]}}}");
   Output("{\"id\":\"file\",\"method\":\"item/fileChange/requestApproval\",\"params\":{\"threadId\":\"fixture-chat\",\"turnId\":\"turn\",\"itemId\":\"f\",\"startedAtMs\":1}}");
   Output("{\"id\":\"grant\",\"method\":\"item/permissions/requestApproval\",\"params\":{\"threadId\":\"fixture-chat\",\"turnId\":\"turn\",\"itemId\":\"p\",\"startedAtMs\":1,\"cwd\":\"fixture\",\"permissions\":{\"network\":{\"enabled\":true}}}}");
  }else if(m.ContainsKey("id")&&m.ContainsKey("result")){
   count++;Output("{\"method\":\"fixture/received\",\"params\":{\"count\":"+count+",\"response\":"+line+"}}");
   Output("{\"method\":\"serverRequest/resolved\",\"params\":{\"threadId\":\"fixture-chat\",\"requestId\":"+json.Serialize(m["id"])+"}}");
  }
 }}
}
