import React,{Component,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import Centre from './App';
import {CallingProvider} from './Calling';
import './style.css';
class AppBoundary extends Component<{children:ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return {error:e.message||'Unexpected interface error'}}render(){if(this.state.error)return <div className="loading"><h2>TC Connect could not display this screen.</h2><p>{this.state.error}</p><button className="btn" onClick={()=>location.reload()}>Reload application</button><p>Keep the launcher window open. If the problem continues, note the error shown above.</p></div>;return this.props.children}}
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppBoundary><CallingProvider><Centre/></CallingProvider></AppBoundary></React.StrictMode>);
