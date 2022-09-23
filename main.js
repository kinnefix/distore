"use strict";
const{WebSocket,WebSocketServer}=require("ws");
const fs=require("fs");
const token=fs.readFileSync("token.txt","utf-8");
const https=require("https");
const http=require("http");
const messageDict={};
const express=require("express");
const Session=require("express-session");
const bodyParser=require("body-parser");
const app=express();
const httpServer=http.createServer(app);
const wss=new WebSocketServer({clientTracking:false,noServer:true});
let nextFileId=0;
const pluginDict={};
wss.on("connection",function(s,request){
	let pluginId=null;
	console.log("Connection");
	s.on("message",function(data){
		const bufferCount=data.readInt32LE(0);
		console.log(bufferCount);
		const bufferLengths=[];
		const bufferOffsets=[];
		let offset=4;
		for(let i=0;i<bufferCount;++i){
			bufferLengths[i]=data.readInt32LE(offset);
			offset+=4;
		}
		const jsonString=data.toString("utf-8",offset,offset+bufferLengths[0]);
		const{op,params}=JSON.parse(jsonString);
		if(op==0){
			const id=params["id"];
			pluginId=id;
			pluginDict[pluginId]=s;
			console.log("Plugin pluginId="+pluginId+" Registered");
			pluginDict[id]=s;
		}else if(op==1){
			const channelId=params["channelId"];
			const content=params["content"];
			sendMessage(channelId,content);
		}else if(op==2){
			offset+=bufferLengths[0];
			const extraData=data.subarray(offset,offset+bufferLengths[1]);
			console.log(data.length,extraData.length,bufferLengths[1]);
			const channelId=params["channelId"];
			let fileId=nextFileId++;
			const filePath=""+fileId+".png";
			const saveFilePath="files/"+fileId+".png";
			fs.writeFileSync(saveFilePath,extraData);
			sendMessage(channelId,"",filePath);
		}
	});
});
const sessionParser=Session({
	cookie:{
		httpOnly:false,
		maxAge:24*60*60*1000,
		secure:false
	},
	secret:"---!++",
	resave:false,
	saveUninitialized:true,
});
app.use(sessionParser);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
let sequence=null;
let resumeGatewayURL;
let sessionId;
let ws;
function heartBeat(interval){
	setTimeout(function(){
		heartBeat(interval);
	},interval);
	ws.send(JSON.stringify({
		"op":1,
		"d":sequence
	}));
}
function sendMessage(channelId,msg,imgFileName){
	const dataObject={};
	if(imgFileName){
		dataObject["content"]="http://221.138.212.98:8080/"+imgFileName+"?"+Math.floor(1000*Math.random())
	}else{
		dataObject["content"]=msg;
	}
	const data=JSON.stringify(dataObject);
	const req=https.request({
		"hostname":"discordapp.com",
		"path":"/api/channels/"+channelId+"/messages",
		"method":"POST",
		"headers":{
			"Content-Type":"application/json",
			"Authorization":token
		}
	},function(res){
		let str="";
		res.on("data",function(d){
			str+=d.toString();
		});
		res.on("end",function(){
			console.log(str);
		});
	});
	req.write(data);
	req.end();
}
function onWSMessage({data}){
	data=JSON.parse(data);
	if(data.op==10){
		const interval=data.d.heartbeat_interval;
		setTimeout(function(){
			heartBeat(interval);
		},Math.floor(interval*9/10));
		ws.send(JSON.stringify({
			"op":2,
			"d":{
				"token":token,
				"intents":513|(1<<9)|(1<<15),
				"properties":{
				  "os":"linux",
				  "browser":"my_library",
				  "device":"my_library"
				}
			}
		}));
	}else if(data.op==6){
		resumeGatewayURL=data.d.resume_gateway_url;
		sessionId=data.d.session_id;
		sequence=data.d.seq;
	}else if(data.op==0){
		if(data.t==="MESSAGE_CREATE"){
			console.log("CREATE",data.d.guild_id,data.d.channel_id,data.d.id,data.d.content);
			for(let pluginId in pluginDict){
				const webSocket=pluginDict[pluginId];
				webSocket.send(JSON.stringify({
					op:"+",
					params:{
						guildId:data.d.guild_id,
						channelId:data.d.channel_id,
						authorId:data.d.author.id,
						messageId:data.d.id,
						content:data.d.content
					}
				}));
			}
		}else if(data.t==="MESSAGE_DELETE"){
			for(let pluginId in pluginDict){
				const webSocket=pluginDict[pluginId];
				webSocket.send(JSON.stringify({
					op:"-",
					params:{
						guildId:data.d.guild_id,
						channelId:data.d.channel_id,
						messageId:data.d.id,
					}
				}));
			}
		}else if(data.t==="READY"){
			resumeGatewayURL=data.d.resume_gateway_url;
			sessionId=data.d.session_id;
		}
		sequence=data.s;
	}else if(data.op==1){
		ws.send(JSON.parse({
			"op":1
		}));
	}
}
function createWebSocket(url){
	ws=new WebSocket(url);
	ws.onopen=function(){
		console.log("Opened");
	};
	ws.onclose=ws.onerror=function(e){
		createWebSocket(resumeGatewayURL);
		ws.send(JSON.stringify({
			"op":6,
			"d":{
				"token":token,
				"session_id":sessionId,
				"seq":sequence
			}
		}));
	};
	ws.onmessage=onWSMessage;
}
app.use(express.static("files"));
httpServer.on("upgrade",function(request,socket,head){
	console.log("upgrade");
	sessionParser(request,{},function(){
		wss.handleUpgrade(request,socket,head,function(ws){
			wss.emit("connection",ws,request);
		});
	});
});
httpServer.listen(80,function(){
	console.log("Running");
});
createWebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
