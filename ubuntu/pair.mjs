import {isOwner} from '../telegram.mjs';

export async function pairOwner(api,botUsername,code,startedAt=Date.now()) {
 let offset=0;
 const deadline=startedAt+5*60_000;
 while(Date.now()<deadline){
  const updates=await api.call('getUpdates',{offset,timeout:5,allowed_updates:['message','callback_query']});
  if(!Array.isArray(updates))throw new Error('Invalid pairing response.');
  for(const update of updates){
   if(!Number.isSafeInteger(update.update_id)||update.update_id<offset||update.update_id>=Number.MAX_SAFE_INTEGER)continue;
   offset=update.update_id+1;
   const message=update.message;
   const userId=String(message?.from?.id);
   const owner={userId,chatId:userId,botUsername};
   if(Date.now()<deadline&&/^[1-9]\d{0,15}$/.test(userId)&&isOwner(update,owner)
     &&message.text==='/pair '+code&&Number.isSafeInteger(message.date)&&message.date*1000>=startedAt-1000){
    return {owner,offset};
   }
  }
 }
 throw new Error('Pairing expired. Run setup again for a new code.');
}
