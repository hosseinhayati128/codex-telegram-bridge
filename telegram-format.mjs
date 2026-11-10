import path from 'node:path';

const styles={
 '***':['bold','italic'],'___':['bold','italic'],
 '**':['bold'],'__':['bold'],'*':['italic'],'_':['italic'],'~~':['strikethrough'],
};
const absoluteFile=/^(?:[a-z]:[\\/]|\/(?!\/)|file:\/)/i;
const lineCitation=/:\d+(?:-\d+)?$/;
const inline=/\\(?<escaped>[\\\x60*_[\]{}~#+.!()<>-])|(?<comment><!--.*?(?:-->|$))|(?<!\x60)(?<ticks>\x60+)(?!\x60)(?<code>.*?)(?<!\x60)\k<ticks>(?!\x60)|:codex-file-citation\{(?<citation>(?:"(?:\\.|[^"\\])*"|[^"{}])*)\}|!?\[(?<label>(?:\\.|[^\\[\]])*)\]\((?:[ \t]*<(?<angle>[^<>]+)>[ \t]*(?:["'][^"']*["'][ \t]*)?|(?<target>[^()\r\n]*(?:\([^()\r\n]*\)[^()\r\n]*)*))\)|(?<marker>\*{1,3}|_{1,3}|~~)/g;
const openFence=/^(?:[ \t]*>)*[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(\x60{3,}|~{3,})(.*)$/;
const closeFence=/^(?:[ \t]*>)*[ \t]*(\x60{3,}|~{3,})[ \t]*$/;
const word=char=>!!char&&/[\p{L}\p{N}]/u.test(char);

function webLink(target){
 if(!/^https?:\/\//i.test(target)||target.length>2048||/[\x00-\x20]/.test(target))return;
 try{
  const url=new URL(target);
  if(url.hostname&&!url.username&&!url.password)return url.href;
 }catch{}
}

function fileLabel(target){
 const file=target.replace(lineCitation,'');
 if(/^file:/i.test(file)){
  try{return decodeURIComponent(path.posix.basename(new URL(file).pathname));}catch{}
 }
 return path.win32.basename(file);
}

export function formatCodexText(source,heading=''){
 source=String(source??'');
 const entities=[],files=new Set();
 let text='',plain='',inComment=false;
 function append(value,emphasis=[],entity){
  if(!value)return;
  const offset=text.length,length=value.length;
  text+=value;
  plain+=value;
  const styled=value.trim();
  if(styled&&!['code','pre'].includes(entity?.type)){
   for(const type of new Set(emphasis))entities.push({type,offset:offset+value.indexOf(styled),length:styled.length});
  }
  if(entity)entities.push({...entity,offset,length});
 }
 function fileReference(target){
  if(absoluteFile.test(target)&&!lineCitation.test(target))files.add(target.replace(/^file:/i,'file:'));
 }
 function renderLine(line,forced=[],linkLabel=false){
  if(inComment){
   const end=line.indexOf('-->');
   if(end<0)return;
   line=line.slice(end+3);
   inComment=false;
  }
  // shortcut: keep overlong individual lines literal to bound work on malformed Markdown.
  if(line.length>16_384){
   append(line);
   return;
  }
  const tokens=Array.from(line.matchAll(inline),m=>({start:m.index,end:m.index+m[0].length,literal:m[0],...m.groups}));
  const stack=[],openers=new Map();
  for(const token of tokens){
   if(!token.marker)continue;
   const before=line[token.start-1],after=line[token.end];
   if(token.marker.startsWith('_')&&word(before)&&word(after))continue;
   const previous=openers.get(token.marker);
   if(previous!==undefined&&before&&!/\s/u.test(before)){
    token.close=true;
    stack[previous].open=true;
    while(stack.length>previous){
     const opener=stack.pop();
     openers.set(opener.marker,opener.previous);
    }
   }else if(after&&!/\s/u.test(after)){
    token.previous=previous;
    openers.set(token.marker,stack.length);
    stack.push(token);
   }
  }
  const active=new Map();
  const style=(marker,change)=>{
   for(const type of styles[marker]){
    const count=(active.get(type)??0)+change;
    if(count)active.set(type,count);else active.delete(type);
   }
  };
  let from=0;
  const emphasis=()=>[...forced,...active.keys()];
  const emit=(value,entity)=>append(value,emphasis(),entity);
  for(const token of tokens){
   emit(line.slice(from,token.start));
   from=token.end;
   if(token.open){style(token.marker,1);continue;}
   if(token.close){style(token.marker,-1);continue;}
   if(token.comment!==undefined){if(!linkLabel)inComment=!token.comment.endsWith('-->');continue;}
   if(token.escaped!==undefined){emit(token.escaped);continue;}
   if(token.code!==undefined){
    const code=token.code.startsWith(' ')&&token.code.endsWith(' ')&&token.code.trim()?token.code.slice(1,-1):token.code;
    emit(code,linkLabel?undefined:{type:'code'});
    continue;
   }
   if(token.citation!==undefined&&!linkLabel){
    const attribute=Array.from(token.citation.matchAll(/(?:^|\s)([a-z][\w-]*)\s*=\s*"((?:\\.|[^"\\])*)"/gi)).find(match=>match[1].toLowerCase()==='path');
    if(!attribute){emit(token.literal);continue;}
    const target=attribute[2].replace(/\\(["\\])/g,'$1');
    fileReference(target);
    const name=fileLabel(target);
    emit(name?'📎 '+name:token.literal);
    continue;
   }
   if(token.label!==undefined&&!linkLabel){
    const target=(token.angle??token.target.trim().replace(/[ \t](?:"[^"]*"|'[^']*')$/,'')).trim();
    const url=webLink(target);
    fileReference(target);
    const start=text.length;
    if(token.label)renderLine(token.label,emphasis(),true);
    if(text.length===start)emit(url||(absoluteFile.test(target)?fileLabel(target):token.literal));
    if(url&&text.length>start){
     entities.push({type:'text_link',url,offset:start,length:text.length-start});
     if(text.slice(start)!==url)plain+=' ('+url+')';
    }
    continue;
   }
   emit(token.literal);
  }
  emit(line.slice(from));
 }

 if(heading&&source.startsWith(heading)){
  const end=heading.indexOf('\n');
  const title=end<0?heading:heading.slice(0,end);
  append(title,['bold']);
  append(heading.slice(title.length));
  source=source.slice(heading.length);
 }
 // shortcut: render the inline and fenced Markdown used in Codex replies; use a full parser if more syntax is needed.
 const lines=source.split(/\r?\n/);
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  const fence=inComment?null:openFence.exec(line);
  if(fence&&!(fence[1][0]==='\x60'&&fence[2].includes('\x60'))){
   const block=[];
   const language=/^[a-z0-9_+.#-]{1,32}$/i.test(fence[2].trim())?fence[2].trim():undefined;
   while(index+1<lines.length){
    const next=lines[++index],closing=closeFence.exec(next)?.[1];
    if(closing?.[0]===fence[1][0]&&closing.length>=fence[1].length)break;
    block.push(next);
   }
   append(block.join('\n'),[],{type:'pre',...(language?{language}:{})});
  }else if(!inComment&&/^(?: {4}|\t)/.test(line))append(line);
  else{
   const titleLine=!inComment&&/^ {0,3}#{1,6}[ \t]+(\S.*)$/.exec(line);
   if(titleLine)renderLine(titleLine[1].trimEnd().replace(/[ \t]#+$/,'').trimEnd(),['bold']);
   else renderLine(line.replace(/^( {0,3})[-+*][ \t]+(?=\S)/,'$1• '));
  }
  if(index<lines.length-1)append('\n');
 }
 entities.sort((a,b)=>a.offset-b.offset||b.length-a.length);
 return {text,plain,entities,files:[...files]};
}
