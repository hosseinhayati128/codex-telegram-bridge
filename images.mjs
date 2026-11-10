import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite} from './state.mjs';

export const MAX_IMAGE_BYTES=50_000_000;
const MAX_BASE64=Math.ceil(MAX_IMAGE_BYTES/3)*4;
const MAX_CACHE_ENTRY=MAX_BASE64+4096;
const CACHE_BYTES=256_000_000;
const CACHE_AGE=24*3600_000;
const cacheDir=root=>path.join(root,'private','tool-images');
const cacheKey=(threadId,turnId,itemId)=>createHash('sha256').update(JSON.stringify([threadId,turnId,itemId])).digest('hex');
const cacheName=/^[0-9a-f]{64}\.json$/;
const localPath=/^(?:[a-z]:[\\/]|\/(?!\/)|file:\/\/\/)/i;
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const extensions=new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.tif','.tiff']);
export const rasterPath=file=>extensions.has(path.extname(file).toLowerCase());

export function imageFormat(bytes){
 const ascii=(start,end)=>bytes.toString('ascii',start,end);
 if(bytes.length>=29&&bytes.subarray(0,8).equals(pngSignature)&&ascii(12,16)==='IHDR'){
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
  if(!w||!h)return;
  return {extension:'png',mime:'image/png',photo:w+h<=10000&&Math.max(w,h)<=20*Math.min(w,h)};
 }
 if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {extension:'jpg',mime:'image/jpeg',photo:true};
 if(bytes.length>=13&&['GIF87a','GIF89a'].includes(ascii(0,6)))return {extension:'gif',mime:'image/gif'};
 if(bytes.length>=16&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return {extension:'webp',mime:'image/webp'};
 if(bytes.length>=26&&ascii(0,2)==='BM')return {extension:'bmp',mime:'image/bmp'};
 if(bytes.length>=8&&['49492a00','4d4d002a'].includes(bytes.subarray(0,4).toString('hex')))return {extension:'tif',mime:'image/tiff'};
}

export function markdownImageParts(text){
 const parts=[];
 // shortcut: inline Markdown images only; add a Markdown parser if reference-style images are needed.
 const code=/<!--[\s\S]*?(?:-->|(?![\s\S]))|^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(?<fence>(?<mark>[\x60~])\k<mark>{2,})[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:^(?:[ \t]*>[ \t]?)*[ \t]*\k<fence>\k<mark>*[ \t]*(?:\r?\n|$)|(?![\s\S]))|^(?: {0,3}>[ \t]?)*(?: {4}|\t)[^\r\n]*|(?<!\x60)(?<ticks>\x60+)(?!\x60)[\s\S]*?(?<!\x60)\k<ticks>(?!\x60)/gm;
 const visible=text.replace(code,block=>block.replace(/[^\r\n]/g,' '));
 const tokens=/!\[([^\]\r\n]*)\]\([ \t]*(?:<([^>\r\n]+)>[ \t]*(?:["'][^"'\r\n]*["'][ \t]*)?|([^()\r\n]*(?:\([^()\r\n]*\)[^()\r\n]*)*))\)/g;
 let end=0;
 for(const match of visible.matchAll(tokens)){
  if(/(?<!\\)(?:\\\\)*\\$/.test(text.slice(0,match.index))||text.slice(match.index,match.index+match[0].length)!==match[0])continue;
  const file=(match[2]??match[3].replace(/[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*')[ \t]*$/,'')).trim();
  if(!localPath.test(file)||!rasterPath(file))continue;
  if(match.index>end)parts.push({text:text.slice(end,match.index)});
  const caption=match[1];
  if([...caption].length>1024)parts.push({text:caption});
  parts.push({text:match[0],image:{path:file,caption:[...caption].length<=1024?caption:undefined}});
  end=match.index+match[0].length;
 }
 if(end<text.length)parts.push({text:text.slice(end)});
 return parts;
}

export function toolImagePart(root,threadId,turnId,item){
 if(typeof item.id!=='string')return;
 if(item.type==='imageView'&&typeof item.path==='string'&&localPath.test(item.path))return {path:item.path};
 if(!['mcpToolCall','dynamicToolCall'].includes(item.type))return;
 const name=cacheKey(threadId,turnId,item.id)+'.json';
 if(fs.existsSync(path.join(cacheDir(root),name)))return {itemId:item.id};
}

export function saveToolImages(root,message,watched){
 if(message.method!=='item/completed')return;
 const {threadId,turnId,item}=message.params??{};
 if(!watched.has(threadId)||typeof turnId!=='string'||typeof item?.id!=='string')return;
 const blocks=item.type==='mcpToolCall'?item.result?.content:item.type==='dynamicToolCall'?item.contentItems:null;
 if(!Array.isArray(blocks))return;
 const images=[];
 let encodedBytes=0;
 for(const block of blocks){
  const inline=block?.type==='inputImage'&&typeof block.imageUrl==='string'?/^data:(image\/[\w+-]+);base64,/.exec(block.imageUrl):null;
  const mime=block?.type==='image'?block.mimeType:inline?.[1];
  const data=block?.type==='image'?block.data:inline&&block.imageUrl.slice(inline[0].length);
  if(!/^image\/(?:png|jpeg|gif|webp|bmp|tiff)$/.test(mime??'')||typeof data!=='string'||!data.length||data.length+encodedBytes>MAX_BASE64||/[^A-Za-z0-9+/=]/.test(data))continue;
  images.push({mime,data});
  encodedBytes+=data.length;
  if(images.length===16)break;
 }
 if(!images.length)return;
 const dir=cacheDir(root);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const files=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&cacheName.test(e.name)).map(e=>{
  const file=path.join(dir,e.name),stat=fs.statSync(file,{throwIfNoEntry:false});
  return {file,size:stat?.size??0,mtime:stat?.mtimeMs??0};
 }).sort((a,b)=>b.mtime-a.mtime);
 // shortcut: bound the private replay cache to one day and a disk budget; use durable media storage for longer outages.
 let total=encodedBytes+4096;
 for(const file of files){
  total+=file.size;
  if(Date.now()-file.mtime>CACHE_AGE||total>CACHE_BYTES){fs.rmSync(file.file,{force:true});total-=file.size;}
 }
 atomicWrite(path.join(dir,cacheKey(threadId,turnId,item.id)+'.json'),images);
}

export function readToolImages(root,threadId,turnId,itemId){
 try{
  const name=cacheKey(threadId,turnId,itemId)+'.json';
  const file=path.join(cacheDir(root),name),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size>MAX_CACHE_ENTRY||Date.now()-stat.mtimeMs>CACHE_AGE)return [];
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  return Array.isArray(rows)?rows:[];
 }catch{return [];}
}

export function decodeToolImage(row){
 const {data,mime}=row??{};
 if(typeof data!=='string'||data.length>MAX_BASE64)return;
 const bytes=Buffer.from(data,'base64');
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES||bytes.toString('base64')!==data)return;
 const format=imageFormat(bytes);
 if(format?.mime===mime)return {bytes,format,name:'codex-image.'+format.extension};
}
