export type Signal={seq:number;kind:'offer'|'answer'|'ice';payload:any};
export class AudioConnection{
 pc:RTCPeerConnection;pending:RTCIceCandidateInit[]=[];cursor=0;closed=false;offered=false;answered=false;chain:Promise<void>=Promise.resolve();
 constructor(readonly stream:MediaStream,readonly send:(kind:string,payload:any)=>Promise<any>,iceServers:RTCIceServer[],readonly onRemote:(stream:MediaStream)=>void,readonly onState:(state:string)=>void){
  this.pc=new RTCPeerConnection({iceServers,bundlePolicy:'max-bundle'});
  stream.getAudioTracks().forEach(t=>this.pc.addTrack(t,stream));
  this.pc.onicecandidate=e=>{if(e.candidate&&!this.closed)this.send('ice',e.candidate.toJSON()).catch(()=>this.onState('signal-error'))};
  this.pc.ontrack=e=>{if(e.track.kind==='audio')onRemote(e.streams[0]||new MediaStream([e.track]))};
  this.pc.onconnectionstatechange=()=>onState(this.pc.connectionState);
 }
 async offer(){if(this.offered||this.closed)return;this.offered=true;const offer=await this.pc.createOffer();await this.pc.setLocalDescription(offer);await this.send('offer',this.pc.localDescription?.toJSON())}
 consume(signals:Signal[]){this.chain=this.chain.then(()=>this.apply(signals));return this.chain}
 async apply(signals:Signal[]){for(const s of signals){if(this.closed||s.seq<=this.cursor)continue;if(s.kind==='ice'){if(this.pc.remoteDescription)await this.pc.addIceCandidate(s.payload);else this.pending.push(s.payload)}else{
   if(!this.pc.remoteDescription)await this.pc.setRemoteDescription(s.payload);
   for(const candidate of this.pending.splice(0))await this.pc.addIceCandidate(candidate);
   if(s.kind==='offer'&&!this.answered){this.answered=true;const answer=await this.pc.createAnswer();await this.pc.setLocalDescription(answer);await this.send('answer',this.pc.localDescription?.toJSON())}
  }this.cursor=s.seq;}}
 mute(value:boolean){this.stream.getAudioTracks().forEach(t=>t.enabled=!value)}
 close(){if(this.closed)return;this.closed=true;this.pc.onicecandidate=null;this.pc.ontrack=null;this.pc.onconnectionstatechange=null;this.pc.close();this.stream.getTracks().forEach(t=>t.stop())}
}
