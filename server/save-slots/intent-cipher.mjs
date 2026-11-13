import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const aad=(i,keyId)=>Buffer.from(JSON.stringify([keyId,i.owner,i.requestId,i.cityId,i.sessionHash,i.expectedRevision,i.bodyHash,i.payloadHash,i.rawHash]));
/** Keys must come from a trusted host key manager; never serialize/log them. */
export function createIntentCipher({currentKeyId,getKey}) {
 if(typeof currentKeyId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(currentKeyId)||typeof getKey!=='function')throw Error('invalid-key-provider');
 function key(id){const k=getKey(id);if(!Buffer.isBuffer(k)||k.length!==32)throw Error('intent-key-unavailable');return k;}
 return {
  seal(i){
   const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(currentKeyId),nonce);cipher.setAAD(aad(i,currentKeyId));
   const ciphertext=Buffer.concat([cipher.update(i.body,'utf8'),cipher.final()]);return {keyId:currentKeyId,nonce,tag:cipher.getAuthTag(),ciphertext};
  },
  open(i,encrypted){
   if(!encrypted||typeof encrypted.keyId!=='string'||!Buffer.isBuffer(encrypted.nonce)||encrypted.nonce.length!==12||!Buffer.isBuffer(encrypted.tag)||encrypted.tag.length!==16||!Buffer.isBuffer(encrypted.ciphertext))throw Error('invalid-intent-ciphertext');
   const decipher=createDecipheriv('aes-256-gcm',key(encrypted.keyId),encrypted.nonce);decipher.setAAD(aad(i,encrypted.keyId));decipher.setAuthTag(encrypted.tag);
   return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat([decipher.update(encrypted.ciphertext),decipher.final()]));
  }
 };
}
