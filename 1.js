// ==UserScript==
// @name         百度网盘在线视频播放器
// @namespace    https://example.com/
// @version      3.10
// @description  百度网盘视频在线播放，支持倍速调节（0.25x-4x）、画质切换（360P-1080P），记忆播放进度，新标签页打开
// @match        https://pan.baidu.com/s/*
// @grant        unsafeWindow
// @run-at       document-end
// @icon         https://nd-static.bdstatic.com/m-static/wp-brand/favicon.ico
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    var PROGRESS_EXPIRY_DAYS = 7;
    var EXPIRY_MS = PROGRESS_EXPIRY_DAYS * 24 * 3600 * 1000;

    function isTouchDevice() {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    }

    function isTablet() {
        return isTouchDevice() && window.innerWidth >= 600;
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '';
        var s = Math.floor(seconds);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') : m + ':' + String(sec).padStart(2, '0');
    }

    function getFileName(file) {
        return file.server_filename || file.filename || file.name || file.title || '未知文件';
    }

    function getFolderName() {
        var hash = location.hash;
        var match = hash.match(/path=([^&]+)/);
        if (match) {
            var path = decodeURIComponent(match[1]);
            var idx = path.indexOf('sharelink');
            if (idx >= 0) {
                var sub = path.substring(idx);
                var parts = sub.split('/');
                if (parts.length > 1) parts.shift();
                return parts.join('/') || '根目录';
            }
            return path || '根目录';
        }
        return '根目录';
    }

    function getSurId() {
        return (location.pathname.match(/\/s\/(\w+)/) || [])[1] || '';
    }

    function getCurrentList() {
        try {
            var ctx = unsafeWindow.require('system-core:context/context.js');
            var list = ctx.instanceForSystem.list.getCurrentList();
            if (list && list.length) {
                sessionStorage.setItem(getSurId(), JSON.stringify(list));
                return list;
            }
        } catch (e) {}
        try {
            if (unsafeWindow.__LIST__ && unsafeWindow.__LIST__.length) {
                sessionStorage.setItem(getSurId(), JSON.stringify(unsafeWindow.__LIST__));
                return unsafeWindow.__LIST__;
            }
        } catch (e) {}
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
            var text = scripts[i].textContent;
            if (text && text.indexOf('"list":[') !== -1 && text.indexOf('"category"') !== -1) {
                try {
                    var match = text.match(/"list":(\[.*?\]),/) || text.match(/"list":(\[.*?\])/);
                    if (match) {
                        var list = JSON.parse(match[1]);
                        if (list && list.length) {
                            sessionStorage.setItem(getSurId(), JSON.stringify(list));
                            return list;
                        }
                    }
                } catch (e) {}
            }
        }
        var cached = sessionStorage.getItem(getSurId());
        if (cached) {
            try { return JSON.parse(cached); } catch (e) {}
        }
        return [];
    }

    function filterVideos(list) {
        if (!list || !list.length) return [];
        return list.filter(function(i) {
            if (i.hasOwnProperty('category')) return i.category === 1;
            var name = getFileName(i).toLowerCase();
            return /\.(mp4|mkv|webm|avi|mov|flv|wmv|ts|m3u8)$/i.test(name);
        });
    }

    function getCachedVideoList(surId) {
        var key = 'bd_video_cache_' + surId;
        var cached = localStorage.getItem(key);
        if (cached) {
            try { return JSON.parse(cached); } catch (e) {}
        }
        return null;
    }

    function safeJsonStringify(obj) {
        return JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');
    }

    function cleanExpiredProgress() {
        var now = Date.now();
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && (key.indexOf('bd_play_progress_') === 0 || key.indexOf('bd_last_path_') === 0)) {
                try {
                    var data = JSON.parse(localStorage.getItem(key));
                    if (data && data.time) {
                        var age = now - data.time;
                        if (age > EXPIRY_MS) {
                            keysToRemove.push(key);
                        }
                    }
                } catch (e) {}
            }
        }
        keysToRemove.forEach(function(key) {
            localStorage.removeItem(key);
        });
    }

    // ============ 构建完整播放器页面 ============
    function buildPlayerPage(videoList, shareInfo, folderName) {
        if (!videoList || !videoList.length) {
            var surId = getSurId();
            var cachedList = getCachedVideoList(surId);
            if (cachedList && cachedList.length) {
                videoList = cachedList;
            } else {
                return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>百度网盘视频播放器</title><style>body{background:#0a0a0a;color:#ccc;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;}</style></head><body><div><h1 style="color:#1890ff;">🎬 百度网盘视频播放器</h1><p style="color:#888;font-size:16px;">当前文件夹没有视频文件</p></div></body></html>';
            }
        }

        var surId = getSurId();
        var isTabletDevice = isTablet();

        var enhancedVideos = [];
        videoList.forEach(function(v, idx) {
            var name = getFileName(v);
            var fid = v.fs_id || v.fid || v.id || ('fid_' + idx);
            if (name && fid) {
                enhancedVideos.push({
                    id: idx,
                    name: name,
                    fid: fid,
                    duration: 0,
                    fullPath: surId + '|' + folderName + '/' + name
                });
            }
        });
        enhancedVideos.sort(function(a, b) {
            return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
        });
        enhancedVideos.forEach(function(v, i) { v.id = i; });

        var videoDataLiteral = safeJsonStringify(enhancedVideos);
        var shareDataLiteral = safeJsonStringify(shareInfo);
        var folderLiteral = safeJsonStringify(folderName);
        var dirKey = surId + '|' + folderName;

        var hlsCdn1 = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.6/hls.min.js';
        var hlsCdn2 = 'https://unpkg.com/hls.js@1.6.6/dist/hls.min.js';
        var hlsCdn3 = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.6/dist/hls.min.js';

        // ========== 先构建 JS 代码 ==========
        var jsCode = [];
        jsCode.push('(function(){');
        jsCode.push('var vd = ' + videoDataLiteral + ';');
        jsCode.push('var sd = ' + shareDataLiteral + ';');
        jsCode.push('var folder = ' + folderLiteral + ';');
        jsCode.push('var dirKey = ' + safeJsonStringify(dirKey) + ';');
        jsCode.push('var EXPIRY_MS = ' + EXPIRY_MS + ';');
        jsCode.push('function $(id){return document.getElementById(id)}');
        jsCode.push('var ve=$("video"),ov=$("ovl"),ib=$("info-text"),pb=$("pbar"),pf=$("pfill"),tl=$("tlabel"),vl=$("vlist"),sx=$("search"),spd=$("speed-select"),qsel=$("quality-select"),vsl=$("vol-slider"),pa=$("p-area"),ovt=$("ovl-text"),cpb=$("copy-btn"),toast=$("toast");');
        jsCode.push('var sb=$("sidebar"),rs=$("resizer"),foldBtn=$("fold-sidebar-btn"),unfoldBtn=$("unfold-sidebar"),toggleSidebarBtn=$("toggle-sidebar-btn"),pipBtn=$("pip-btn"),fullscreenBtn=$("fullscreen-btn"),mainEl=$("main");');
        jsCode.push('var volIcon=$("vol-icon");');
        jsCode.push('var ci=-1,cq=1080,hs=null,drg=false,curUrl="",curSpeed=1,sideVisible=true,saveTimer=null,endedFlag=false,_lastTimeUpdate=-1;');
        jsCode.push('var fullscreenHideTimer=null,isFullscreen=false,controlsVisible=true;');

        jsCode.push('function fmtDur(s){if(!s||s<=0)return"";s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h>0?h+":"+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0"):m+":"+String(sec).padStart(2,"0")}');
        jsCode.push('function ft(t){if(isNaN(t)||t===Infinity||t<0)return"0:00";var h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=Math.floor(t%60);return h>0?h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"):m+":"+String(s).padStart(2,"0")}');

        jsCode.push('function saveProgress(){if(ve.ended||endedFlag)return;if(ci>=0&&vd[ci]&&vd[ci].fid&&ve.currentTime>0){var data={time:Date.now(),progress:ve.currentTime};localStorage.setItem("bd_play_progress_"+vd[ci].fid,JSON.stringify(data))}}');
        jsCode.push('function getProgress(fid){var key="bd_play_progress_"+fid,st=localStorage.getItem(key);if(!st)return 0;try{var d=JSON.parse(st);if(d&&d.time&&d.progress){if(Date.now()-d.time>EXPIRY_MS){localStorage.removeItem(key);return 0}return d.progress}}catch(e){}return 0}');
        jsCode.push('function saveLastVideoPath(v){if(!v||!v.fullPath)return;localStorage.setItem("bd_last_path_"+dirKey,JSON.stringify({time:Date.now(),fullPath:v.fullPath}))}');
        jsCode.push('function getLastVideoIndex(){var st=localStorage.getItem("bd_last_path_"+dirKey);if(!st)return-1;try{var d=JSON.parse(st);if(d&&d.time&&d.fullPath&&Date.now()-d.time<=EXPIRY_MS){for(var i=0;i<vd.length;i++){if(vd[i].fullPath===d.fullPath)return i}}return-1}catch(e){return-1}}');

        jsCode.push('function handleEnded(){if(ve.dataset.endedProcessed==="true")return;ve.dataset.endedProcessed="true";endedFlag=true;ve.pause();ov.style.display="flex";ovt.textContent="播放结束";if(ci>=0&&vd[ci]&&vd[ci].fid)localStorage.removeItem("bd_play_progress_"+vd[ci].fid)}');
        jsCode.push('function resetEnded(){endedFlag=false;ve.dataset.endedProcessed="false";ov.style.display="none";ovt.textContent=""}');
        jsCode.push('function checkEnded(){if(endedFlag)return;var d=ve.duration;if(d&&isFinite(d)&&d>0&&!ve.paused&&ve.currentTime>=d-0.2)handleEnded()}');

        jsCode.push('function userSeek(t){if(endedFlag)resetEnded();ve.currentTime=t;pf.style.width=(t/ve.duration*100)+"%";if(!drg)tl.textContent=ft(t)+" / "+ft(ve.duration);if(ve.paused&&t<ve.duration-0.5)ve.play().catch(function(){})}');

        jsCode.push('function seek(e){var rect=pb.getBoundingClientRect();var cx=e.clientX||(e.touches&&e.touches[0]&&e.touches[0].clientX)||0;var p=Math.max(0,Math.min(1,(cx-rect.left)/rect.width));if(ve.duration&&isFinite(ve.duration))userSeek(p*ve.duration)}');

        jsCode.push('pb.addEventListener("mousedown",function(e){drg=true;seek(e);function mm(ev){seek(ev)}function mu(){drg=false;document.removeEventListener("mousemove",mm);document.removeEventListener("mouseup",mu)}document.addEventListener("mousemove",mm);document.addEventListener("mouseup",mu)});');
        jsCode.push('pb.addEventListener("touchstart",function(e){e.preventDefault();drg=true;seek(e);},{passive:false});');
        jsCode.push('pb.addEventListener("touchmove",function(e){e.preventDefault();seek(e);},{passive:false});');
        jsCode.push('pb.addEventListener("touchend",function(){drg=false;});');

        jsCode.push('rs.addEventListener("mousedown",function(e){var rd=true,sx2=e.clientX,sw=sb.offsetWidth;document.body.style.cursor="col-resize";document.body.style.userSelect="none";e.preventDefault();function mm(ev){if(!rd)return;var w=Math.max(280,Math.min(600,sw+(ev.clientX-sx2)));sb.style.width=w+"px"}function mu(){rd=false;document.body.style.cursor="";document.body.style.userSelect="";document.removeEventListener("mousemove",mm);document.removeEventListener("mouseup",mu)}document.addEventListener("mousemove",mm);document.addEventListener("mouseup",mu)});');

        jsCode.push('function bu(fid,q){return"https://pan.baidu.com/share/streaming?channel=chunlei&uk="+sd.uk+"&fid="+fid+"&sign="+sd.sign+"&timestamp="+sd.ts+"&shareid="+sd.sid+"&type=M3U8_AUTO_"+q+"&vip=2&jsToken="+sd.token}');

        jsCode.push('function renderList(filter){');
        jsCode.push('if(!vl)return;');
        jsCode.push('vl.innerHTML="";');
        jsCode.push('if(!vd||vd.length===0){vl.innerHTML=\'<div style="padding:20px;color:#888;text-align:center;">暂无视频</div>\';return}');
        jsCode.push('var hasFilter = filter && filter.trim().length > 0;');
        jsCode.push('var filtered = vd;');
        jsCode.push('if(hasFilter){');
        jsCode.push('filtered = vd.filter(function(v){return v.name.toLowerCase().indexOf(filter.toLowerCase())>=0});');
        jsCode.push('}');
        jsCode.push('if(filtered.length===0){vl.innerHTML=\'<div style="padding:20px;color:#888;text-align:center;">未找到匹配的视频</div>\';return}');
        jsCode.push('filtered.forEach(function(v,i){');
        jsCode.push('var d=document.createElement("div");d.className="v-item"+(v.id===ci?" cur":"");');
        jsCode.push('var durStr=fmtDur(v.duration);');
        jsCode.push('var nameEscaped = v.name.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");');
        jsCode.push('d.innerHTML=\'<span class="num">\'+(i+1)+\'.</span><span class="name">\'+nameEscaped+\'</span><span class="duration">\'+durStr+\'</span>\';');
        jsCode.push('d.dataset.idx=v.id;');
        jsCode.push('d.addEventListener("mouseenter",function(e){');
        jsCode.push('var nameEl = this.querySelector(".name");');
        jsCode.push('if(nameEl && nameEl.scrollWidth > nameEl.clientWidth){');
        jsCode.push('this.title = v.name;');
        jsCode.push('}else{');
        jsCode.push('this.title = "";');
        jsCode.push('}');
        jsCode.push('});');
        jsCode.push('d.addEventListener("click",function(e){e.stopPropagation();loadVideo(v.id,false);});');
        jsCode.push('vl.appendChild(d);');
        jsCode.push('});');
        jsCode.push('}');

        jsCode.push('function initFolderTitle(){');
        jsCode.push('var folderTitle = document.getElementById("folder-title");');
        jsCode.push('if(!folderTitle)return;');
        jsCode.push('var fullFolderName = folder;');
        jsCode.push('folderTitle.addEventListener("mouseenter",function(){');
        jsCode.push('if(this.scrollWidth > this.clientWidth){');
        jsCode.push('this.title = fullFolderName;');
        jsCode.push('}else{');
        jsCode.push('this.title = "";');
        jsCode.push('}');
        jsCode.push('});');
        jsCode.push('}');

        jsCode.push('function updateDuration(idx){');
        jsCode.push('if(idx<0||idx>=vd.length)return;');
        jsCode.push('if(vd[idx].duration>0)return;');
        jsCode.push('if(ve.duration&&isFinite(ve.duration)&&ve.duration>0){');
        jsCode.push('vd[idx].duration=ve.duration;');
        jsCode.push('var items=vl.querySelectorAll(".v-item");');
        jsCode.push('for(var i=0;i<items.length;i++){');
        jsCode.push('if(parseInt(items[i].dataset.idx)===idx){');
        jsCode.push('var ds=items[i].querySelector(".duration");');
        jsCode.push('if(ds)ds.textContent=fmtDur(ve.duration);');
        jsCode.push('break;');
        jsCode.push('}');
        jsCode.push('}');
        jsCode.push('}');
        jsCode.push('}');

        jsCode.push('function loadVideo(idx,keepTime){');
        jsCode.push('if(idx<0||idx>=vd.length)return;');
        jsCode.push('if(!ve.ended&&!endedFlag&&ci>=0&&vd[ci]&&vd[ci].fid&&ve.currentTime>0){');
        jsCode.push('localStorage.setItem("bd_play_progress_"+vd[ci].fid,JSON.stringify({time:Date.now(),progress:ve.currentTime}));');
        jsCode.push('}');
        jsCode.push('ci=idx;var v=vd[idx];');
        jsCode.push('document.getElementById("folder-title").textContent="📁 "+folder;');
        jsCode.push('ib.textContent=v.name;document.title=v.name+" - 百度网盘视频播放器";');
        jsCode.push('saveLastVideoPath(v);');
        jsCode.push('resetEnded();');
        jsCode.push('ov.style.display="flex";ovt.textContent="加载中...";');
        jsCode.push('ve.pause();ve.removeAttribute("src");ve.load();');
        jsCode.push('if(hs){hs.destroy();hs=null}');
        jsCode.push('var url=bu(v.fid,cq);curUrl=url;');
        jsCode.push('var saved=getProgress(v.fid);');
        jsCode.push('var target=0;');
        jsCode.push('if(keepTime===true&&ve.currentTime>1)target=ve.currentTime;');
        jsCode.push('else if(saved>1)target=saved;');
        jsCode.push('function handleTarget(dur){if(dur>0&&target>=dur-0.5)target=0;if(target>0)ve.currentTime=target}');
        jsCode.push('if(window.Hls&&Hls.isSupported()){');
        jsCode.push('hs=new Hls({enableWorker:false,maxBufferLength:15,maxMaxBufferLength:30,lowLatencyMode:false,startFragPrefetch:true,fragLoadingMaxRetry:3});');
        jsCode.push('hs.loadSource(url);hs.attachMedia(ve);');
        jsCode.push('hs.on(Hls.Events.MANIFEST_PARSED,function(){');
        jsCode.push('handleTarget(ve.duration);');
        jsCode.push('ve.playbackRate=curSpeed;spd.value=curSpeed.toString();');
        jsCode.push('ve.play().then(function(){ov.style.display="none";}).catch(function(){ovt.textContent="点击播放";ov.style.display="flex";});');
        jsCode.push('ve.addEventListener("loadedmetadata",function(){updateDuration(ci);},{once:true});');
        jsCode.push('if(ve.duration&&isFinite(ve.duration))updateDuration(ci);');
        jsCode.push('});');
        jsCode.push('hs.on(Hls.Events.ERROR,function(e,d){if(d.fatal)hs.startLoad()});');
        jsCode.push('}else if(ve.canPlayType("application/vnd.apple.mpegurl")){');
        jsCode.push('ve.src=url;');
        jsCode.push('ve.addEventListener("loadedmetadata",function(){');
        jsCode.push('handleTarget(ve.duration);');
        jsCode.push('ve.playbackRate=curSpeed;spd.value=curSpeed.toString();');
        jsCode.push('updateDuration(ci);');
        jsCode.push('ve.play().then(function(){ov.style.display="none";}).catch(function(){ovt.textContent="点击播放";ov.style.display="flex";});');
        jsCode.push('},{once:true});');
        jsCode.push('}else{');
        jsCode.push('ovt.textContent="当前浏览器不支持播放";ov.style.display="flex";');
        jsCode.push('}');
        jsCode.push('renderList(sx.value);');
        jsCode.push('var prevBtn=$("bprev"),nextBtn=$("bnext");');
        jsCode.push('if(prevBtn)prevBtn.style.opacity=idx===0?"0.3":"1";');
        jsCode.push('if(nextBtn)nextBtn.style.opacity=idx===vd.length-1?"0.3":"1";');
        jsCode.push('setTimeout(function(){');
        jsCode.push('var items=vl.querySelectorAll(".v-item");');
        jsCode.push('for(var i=0;i<items.length;i++){');
        jsCode.push('if(parseInt(items[i].dataset.idx)===idx){');
        jsCode.push('items[i].scrollIntoView({block:"center",behavior:"smooth"});');
        jsCode.push('break;');
        jsCode.push('}');
        jsCode.push('}');
        jsCode.push('},100);');
        jsCode.push('}');

        // 静音相关
        jsCode.push('function toggleMute(){ve.muted=!ve.muted;updateVolumeIcon();}');
        jsCode.push('function updateVolumeIcon(){if(ve.muted||ve.volume===0){volIcon.textContent="🔇";}else if(ve.volume<0.5){volIcon.textContent="🔉";}else{volIcon.textContent="🔊";}}');

        // 全屏鼠标自动隐藏
        jsCode.push('function showFullscreenControls(){');
        jsCode.push('if(!isFullscreen)return;');
        jsCode.push('controlsVisible=true;');
        jsCode.push('mainEl.classList.remove("hide-cursor");');
        jsCode.push('var bars=mainEl.querySelectorAll("#info-bar, #pwrap, #ctrls");');
        jsCode.push('bars.forEach(function(el){el.classList.remove("fullscreen-hidden");el.classList.add("fullscreen-visible");});');
        jsCode.push('clearTimeout(fullscreenHideTimer);');
        jsCode.push('fullscreenHideTimer=setTimeout(function(){');
        jsCode.push('if(isFullscreen){');
        jsCode.push('controlsVisible=false;');
        jsCode.push('mainEl.classList.add("hide-cursor");');
        jsCode.push('var bars2=mainEl.querySelectorAll("#info-bar, #pwrap, #ctrls");');
        jsCode.push('bars2.forEach(function(el){el.classList.remove("fullscreen-visible");el.classList.add("fullscreen-hidden");});');
        jsCode.push('}');
        jsCode.push('},2000);');
        jsCode.push('}');

        jsCode.push('function initFullscreenAutoHide(){');
        jsCode.push('if(!mainEl)return;');
        jsCode.push('mainEl.addEventListener("mousemove",function(e){if(isFullscreen){showFullscreenControls();}});');
        jsCode.push('mainEl.addEventListener("touchstart",function(e){if(isFullscreen){showFullscreenControls();}});');
        jsCode.push('document.addEventListener("keydown",function(e){if(isFullscreen){showFullscreenControls();}});');
        jsCode.push('}');

        jsCode.push('function initPlayer(){');
        jsCode.push('document.getElementById("folder-title").textContent="📁 "+folder;');
        jsCode.push('initFolderTitle();');
        jsCode.push('renderList();');
        jsCode.push('var startIdx=getLastVideoIndex();');
        jsCode.push('if(startIdx<0)startIdx=0;');
        jsCode.push('loadVideo(startIdx,false);');
        jsCode.push('saveTimer=setInterval(function(){if(ve&&!ve.paused&&ve.currentTime>0&&!ve.ended&&!endedFlag)saveProgress()},5000);');
        jsCode.push('window.addEventListener("beforeunload",function(){if(ci>=0&&vd[ci]&&vd[ci].fid&&ve.currentTime>0&&!ve.ended&&!endedFlag){localStorage.setItem("bd_play_progress_"+vd[ci].fid,JSON.stringify({time:Date.now(),progress:ve.currentTime}))}});');
        jsCode.push('updateVolumeIcon();');
        jsCode.push('initFullscreenAutoHide();');
        jsCode.push('}');

        jsCode.push('ve.addEventListener("timeupdate",function(){');
        jsCode.push('if(ve.duration&&isFinite(ve.duration)){');
        jsCode.push('var ct=ve.currentTime;');
        jsCode.push('if(ct===_lastTimeUpdate)return;');
        jsCode.push('_lastTimeUpdate=ct;');
        jsCode.push('pf.style.width=(ct/ve.duration*100)+"%";');
        jsCode.push('if(!drg)tl.textContent=ft(ct)+" / "+ft(ve.duration);');
        jsCode.push('checkEnded();');
        jsCode.push('}');
        jsCode.push('});');
        jsCode.push('ve.addEventListener("play",function(){resetEnded();});');

        jsCode.push('spd.addEventListener("change",function(){curSpeed=parseFloat(spd.value);ve.playbackRate=curSpeed});');
        jsCode.push('qsel.addEventListener("change",function(){var q=parseInt(qsel.value);if(q===cq)return;cq=q;if(ci>=0)loadVideo(ci,true)});');

        jsCode.push('vsl.addEventListener("input",function(){ve.volume=vsl.value/100;if(ve.volume>0)ve.muted=false;updateVolumeIcon();});');
        jsCode.push('volIcon.addEventListener("click",function(e){e.stopPropagation();toggleMute();});');
        jsCode.push('document.getElementById("vol-row").addEventListener("click",function(e){if(e.target!==volIcon&&e.target!==vsl){toggleMute();}});');

        jsCode.push('cpb.addEventListener("click",function(e){e.stopPropagation();if(curUrl)navigator.clipboard.writeText(curUrl).then(function(){showToast("✅ 已复制")}).catch(function(){showToast("❌ 复制失败")})});');

        jsCode.push('function showToast(msg){toast.textContent=msg;toast.style.opacity="1";clearTimeout(toast._t);toast._t=setTimeout(function(){toast.style.opacity="0"},2000)}');

        jsCode.push('sx.addEventListener("input",function(){renderList(sx.value)});');
        jsCode.push('ov.addEventListener("click",function(e){e.stopPropagation();if(endedFlag||ve.ended){ve.currentTime=0;resetEnded()}ve.play().then(function(){ov.style.display="none";}).catch(function(){})});');
        jsCode.push('pa.addEventListener("click",function(e){if(e.target===pa||e.target===ve){if(endedFlag||ve.ended){ve.currentTime=0;resetEnded()}ve.paused?ve.play().catch(function(){}):ve.pause()}});');
        jsCode.push('ve.addEventListener("pause",function(){if(!ve.ended&&!endedFlag){ov.style.display="flex";ovt.textContent=""}});');
        jsCode.push('ve.addEventListener("ended",function(){ov.style.display="flex";if(ci<vd.length-1)setTimeout(function(){loadVideo(ci+1,false)},2000)});');

        jsCode.push('$("bprev").addEventListener("click",function(e){e.stopPropagation();loadVideo(ci-1,false)});');
        jsCode.push('$("bnext").addEventListener("click",function(e){e.stopPropagation();loadVideo(ci+1,false)});');

        jsCode.push('if(pipBtn){');
        jsCode.push('pipBtn.addEventListener("click",function(e){e.stopPropagation();if(document.pictureInPictureElement)document.exitPictureInPicture().catch(function(){});else ve.requestPictureInPicture().catch(function(){})});');
        jsCode.push('ve.addEventListener("enterpictureinpicture",function(){pipBtn.classList.add("on")});');
        jsCode.push('ve.addEventListener("leavepictureinpicture",function(){pipBtn.classList.remove("on")});');
        jsCode.push('if(!document.pictureInPictureEnabled)pipBtn.style.display="none"');
        jsCode.push('}');

        jsCode.push('function toggleSidebar(show){if(show===undefined)show=!sideVisible;if(show){sb.style.display="";rs.style.display="";unfoldBtn.style.display="none";sideVisible=true}else{sb.style.display="none";rs.style.display="none";unfoldBtn.style.display="block";sideVisible=false}}');
        jsCode.push('foldBtn.addEventListener("click",function(e){e.stopPropagation();toggleSidebar(false)});');
        jsCode.push('unfoldBtn.addEventListener("click",function(e){e.stopPropagation();toggleSidebar(true)});');
        jsCode.push('toggleSidebarBtn.addEventListener("click",function(e){e.stopPropagation();toggleSidebar()});');

        jsCode.push('function toggleFullscreen(){');
        jsCode.push('if(!document.fullscreenElement&&!document.webkitFullscreenElement){');
        jsCode.push('if(mainEl.requestFullscreen){mainEl.requestFullscreen().catch(function(){});}else if(mainEl.webkitRequestFullscreen){mainEl.webkitRequestFullscreen();}');
        jsCode.push('isFullscreen=true;');
        jsCode.push('setTimeout(function(){showFullscreenControls();},500);');
        jsCode.push('}else{');
        jsCode.push('if(document.exitFullscreen){document.exitFullscreen().catch(function(){});}else if(document.webkitExitFullscreen){document.webkitExitFullscreen();}');
        jsCode.push('isFullscreen=false;');
        jsCode.push('mainEl.classList.remove("hide-cursor");');
        jsCode.push('var bars=mainEl.querySelectorAll("#info-bar, #pwrap, #ctrls");');
        jsCode.push('bars.forEach(function(el){el.classList.remove("fullscreen-hidden","fullscreen-visible");});');
        jsCode.push('clearTimeout(fullscreenHideTimer);');
        jsCode.push('}');
        jsCode.push('}');

        jsCode.push('fullscreenBtn.addEventListener("click",function(e){e.stopPropagation();toggleFullscreen();});');
        jsCode.push('pa.addEventListener("dblclick",function(e){e.stopPropagation();toggleFullscreen();});');

        jsCode.push('document.addEventListener("fullscreenchange",function(){if(!document.fullscreenElement){isFullscreen=false;mainEl.classList.remove("hide-cursor");var bars=mainEl.querySelectorAll("#info-bar, #pwrap, #ctrls");bars.forEach(function(el){el.classList.remove("fullscreen-hidden","fullscreen-visible");});clearTimeout(fullscreenHideTimer);}});');
        jsCode.push('document.addEventListener("webkitfullscreenchange",function(){if(!document.webkitFullscreenElement){isFullscreen=false;mainEl.classList.remove("hide-cursor");var bars=mainEl.querySelectorAll("#info-bar, #pwrap, #ctrls");bars.forEach(function(el){el.classList.remove("fullscreen-hidden","fullscreen-visible");});clearTimeout(fullscreenHideTimer);}});');

        jsCode.push('document.addEventListener("keydown",function(e){');
        jsCode.push('if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT")return;');
        jsCode.push('switch(e.key.toLowerCase()){');
        jsCode.push('case" ":e.preventDefault();if(endedFlag||ve.ended){ve.currentTime=0;resetEnded()}ve.paused?ve.play():ve.pause();break;');
        jsCode.push('case"arrowleft":e.preventDefault();if(endedFlag)resetEnded();userSeek(Math.max(0,ve.currentTime-5));break;');
        jsCode.push('case"arrowright":e.preventDefault();if(endedFlag)resetEnded();var nt=Math.min(ve.duration,ve.currentTime+5);if(nt>=ve.duration-0.2){handleEnded();return}userSeek(nt);break;');
        jsCode.push('case"arrowup":e.preventDefault();ve.volume=Math.min(1,ve.volume+0.1);vsl.value=ve.volume*100;updateVolumeIcon();break;');
        jsCode.push('case"arrowdown":e.preventDefault();ve.volume=Math.max(0,ve.volume-0.1);vsl.value=ve.volume*100;updateVolumeIcon();break;');
        jsCode.push('case"f":e.preventDefault();toggleFullscreen();break;');
        jsCode.push('case"n":e.preventDefault();loadVideo(ci+1,false);break;');
        jsCode.push('case"p":e.preventDefault();loadVideo(ci-1,false);break;');
        jsCode.push('case"m":e.preventDefault();toggleMute();break;');
        jsCode.push('}');
        jsCode.push('});');

        jsCode.push('initPlayer();');
        jsCode.push('})();');

        var jsString = jsCode.join('\n');

        // ========== 构建 CSS 样式 ==========
        var cssParts = [];
        cssParts.push('*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}');
        cssParts.push('body{background:#0a0a0a;color:#ccc;font-family:"Microsoft YaHei",Arial,sans-serif;display:flex;height:100vh;overflow:hidden}');
        cssParts.push('#resizer{width:4px;cursor:col-resize;background:#2a2a2a;flex-shrink:0}#resizer:hover{background:#1890ff}');
        cssParts.push('#sidebar{width:380px;min-width:280px;max-width:600px;background:#151515;display:flex;flex-direction:column;border-right:1px solid #2a2a2a;flex-shrink:0}');
        cssParts.push('#side-hd{padding:14px;background:#0d0d0d;border-bottom:1px solid #2a2a2a;flex-shrink:0;display:flex;align-items:center;gap:8px}');
        cssParts.push('#side-hd h2{font-size:15px;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
        cssParts.push('#fold-sidebar-btn{background:transparent;border:none;color:#888;font-size:16px;cursor:pointer;padding:2px 4px}#fold-sidebar-btn:hover{color:#1890ff}');
        cssParts.push('#search{width:100%;padding:8px 12px;margin-top:10px;background:#1a1a1a;border:1px solid #333;border-radius:4px;color:#eee;font-size:12px;outline:none}#search:focus{border-color:#1890ff}');
        cssParts.push('#vlist{flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0}');
        cssParts.push('.v-item{padding:8px 14px;cursor:pointer;font-size:12px;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:8px;color:#aaa;transition:all 0.15s;-webkit-tap-highlight-color:transparent;user-select:none}');
        cssParts.push('.v-item:hover{background:#1e1e1e;color:#fff}');
        cssParts.push('.v-item.cur{background:#0d2b45;color:#1890ff;border-left:3px solid #1890ff;padding-left:11px}');
        cssParts.push('.v-item .num{color:#555;min-width:30px;font-size:10px;flex-shrink:0}');
        cssParts.push('.v-item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
        cssParts.push('.v-item .duration{color:#555;font-size:10px;flex-shrink:0;min-width:40px;text-align:right}');
        cssParts.push('#main{flex:1;display:flex;flex-direction:column;background:#000;min-width:0}');
        cssParts.push('#info-bar{width:100%;height:40px;background:#141414;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;padding:0 12px;flex-shrink:0;z-index:10}');
        cssParts.push('#info-text{flex:1;color:#fff;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
        cssParts.push('#copy-btn{padding:4px 8px;border-radius:4px;border:1px solid #444;background:#1e1e1e;color:#ccc;cursor:pointer;font-size:11px;flex-shrink:0}#copy-btn:hover{background:#2a2a2a;border-color:#1890ff;color:#fff}');
        cssParts.push('#p-area{flex:1;position:relative;display:flex;align-items:center;justify-content:center;background:#000;min-height:200px;cursor:pointer}');
        cssParts.push('video{width:100%;height:100%;object-fit:contain}');
        cssParts.push('#ovl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);cursor:pointer;z-index:10}');
        cssParts.push('#ovl .pb{width:80px;height:80px;background:rgba(24,144,255,0.85);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto}#ovl .pb:hover{transform:scale(1.08)}');
        cssParts.push('#ovl .pb span{color:#fff;font-size:36px;margin-left:4px}#ovl p{color:#bbb;margin-top:10px;font-size:14px}');
        cssParts.push('#ctrls{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#141414;border-top:1px solid #222;flex-shrink:0;flex-wrap:wrap}');
        cssParts.push('#ctrls button{padding:5px 10px;border-radius:4px;border:1px solid #444;background:#1e1e1e;color:#ccc;cursor:pointer;font-size:11px;white-space:nowrap}#ctrls button:hover{background:#2a2a2a;border-color:#1890ff;color:#fff}#ctrls button.on{background:#1890ff;border-color:#1890ff;color:#fff}');
        cssParts.push('#ctrls select{padding:4px 8px;border-radius:4px;border:1px solid #444;background:#1e1e1e;color:#ccc;font-size:11px;cursor:pointer;outline:none}#ctrls select:hover{border-color:#1890ff}');
        cssParts.push('#ctrls .spacer{flex:1}');
        cssParts.push('#speed-select{padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1e1e1e;color:#ccc;font-size:11px;cursor:pointer;outline:none}#speed-select:hover{border-color:#1890ff}');
        cssParts.push('#quality-select{padding:4px 6px;border-radius:4px;border:1px solid #444;background:#1e1e1e;color:#ccc;font-size:11px;cursor:pointer;outline:none}#quality-select:hover{border-color:#1890ff}');
        cssParts.push('#pwrap{display:flex;align-items:center;gap:10px;padding:4px 12px;background:#141414;flex-shrink:0}');
        cssParts.push('#pbar{flex:1;height:5px;background:#2a2a2a;border-radius:3px;cursor:pointer;position:relative;min-height:18px}');
        cssParts.push('#pfill{height:100%;background:#1890ff;border-radius:3px;width:0;pointer-events:none}');
        cssParts.push('#tlabel{color:#777;font-size:11px;min-width:95px;text-align:center;flex-shrink:0}');
        cssParts.push('#vol-row{display:flex;align-items:center;gap:4px;cursor:pointer;padding:2px 4px;border-radius:4px;}');
        cssParts.push('#vol-row:hover{background:#2a2a2a;}');
        cssParts.push('#vol-icon{cursor:pointer;font-size:14px;user-select:none;}');
        cssParts.push('#vol-slider{width:60px;height:3px;background:#2a2a2a;border-radius:2px;cursor:pointer;outline:none;-webkit-appearance:none;appearance:none}');
        cssParts.push('#vol-slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;background:#1890ff;border-radius:50%;cursor:pointer}');
        cssParts.push('#unfold-sidebar{display:none;position:fixed;left:0;top:50%;transform:translateY(-50%);background:#1890ff;color:#fff;border:none;padding:8px 4px;border-radius:0 4px 4px 0;cursor:pointer;z-index:1000;font-size:12px}#unfold-sidebar:hover{background:#40a9ff}');
        cssParts.push('#toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1890ff;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;z-index:99999;pointer-events:none;opacity:0;transition:opacity 0.3s}');

        // 全屏样式 - 控制栏自动隐藏
        cssParts.push('#main:fullscreen #info-bar { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:fullscreen #pwrap { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:fullscreen #ctrls { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:fullscreen #sidebar { display: none !important; }');
        cssParts.push('#main:fullscreen #resizer { display: none !important; }');
        cssParts.push('#main:fullscreen .fullscreen-hidden { opacity: 0 !important; pointer-events: none !important; }');
        cssParts.push('#main:fullscreen .fullscreen-visible { opacity: 1 !important; pointer-events: auto !important; }');
        cssParts.push('#main:fullscreen.hide-cursor * { cursor: none !important; }');

        cssParts.push('#main:-webkit-full-screen #info-bar { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:-webkit-full-screen #pwrap { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:-webkit-full-screen #ctrls { display: flex !important; transition: opacity 0.3s ease; }');
        cssParts.push('#main:-webkit-full-screen #sidebar { display: none !important; }');
        cssParts.push('#main:-webkit-full-screen #resizer { display: none !important; }');
        cssParts.push('#main:-webkit-full-screen .fullscreen-hidden { opacity: 0 !important; pointer-events: none !important; }');
        cssParts.push('#main:-webkit-full-screen .fullscreen-visible { opacity: 1 !important; pointer-events: auto !important; }');
        cssParts.push('#main:-webkit-full-screen.hide-cursor * { cursor: none !important; }');

        cssParts.push('#main:fullscreen #info-bar { background: rgba(20,20,20,0.85) !important; }');
        cssParts.push('#main:fullscreen #pwrap { background: rgba(20,20,20,0.85) !important; }');
        cssParts.push('#main:fullscreen #ctrls { background: rgba(20,20,20,0.85) !important; border-top-color: rgba(255,255,255,0.1) !important; }');
        cssParts.push('#main:-webkit-full-screen #info-bar { background: rgba(20,20,20,0.85) !important; }');
        cssParts.push('#main:-webkit-full-screen #pwrap { background: rgba(20,20,20,0.85) !important; }');
        cssParts.push('#main:-webkit-full-screen #ctrls { background: rgba(20,20,20,0.85) !important; border-top-color: rgba(255,255,255,0.1) !important; }');

        // 平板/手机适配
        if (isTabletDevice) {
            cssParts.push('#sidebar { width: 340px !important; min-width: 280px !important; max-width: 500px !important; }');
            cssParts.push('#ctrls { padding: 12px 16px !important; gap: 12px !important; flex-wrap: wrap !important; }');
            cssParts.push('#ctrls button { padding: 12px 20px !important; font-size: 16px !important; min-height: 52px !important; min-width: 52px !important; }');
            cssParts.push('#ctrls select { padding: 12px 16px !important; font-size: 16px !important; min-height: 52px !important; }');
            cssParts.push('#speed-select, #quality-select { padding: 12px 16px !important; font-size: 16px !important; min-height: 52px !important; }');
            cssParts.push('#vol-slider { width: 100px !important; height: 6px !important; }');
            cssParts.push('#vol-slider::-webkit-slider-thumb { width: 24px !important; height: 24px !important; }');
            cssParts.push('#pbar { height: 8px !important; min-height: 28px !important; }');
            cssParts.push('#pwrap { padding: 10px 20px !important; }');
            cssParts.push('#tlabel { font-size: 16px !important; min-width: 130px !important; }');
            cssParts.push('.v-item { padding: 16px 20px !important; font-size: 17px !important; min-height: 58px !important; }');
            cssParts.push('#search { padding: 14px 18px !important; font-size: 17px !important; min-height: 54px !important; }');
            cssParts.push('#side-hd { padding: 18px !important; }');
            cssParts.push('#side-hd h2 { font-size: 19px !important; }');
            cssParts.push('#info-text { font-size: 17px !important; }');
            cssParts.push('#copy-btn { padding: 10px 18px !important; font-size: 15px !important; min-height: 46px !important; }');
            cssParts.push('#fold-sidebar-btn { font-size: 24px !important; padding: 8px 14px !important; }');
            cssParts.push('.v-item .num { min-width: 44px !important; font-size: 15px !important; }');
            cssParts.push('.v-item .duration { min-width: 60px !important; font-size: 15px !important; }');
            cssParts.push('#ovl .pb { width: 110px !important; height: 110px !important; }');
            cssParts.push('#ovl .pb span { font-size: 52px !important; }');
            cssParts.push('#info-bar { height: 56px !important; padding: 0 18px !important; }');
            cssParts.push('#resizer { width: 6px !important; }');
        }

        if (window.innerWidth < 600 && !isTabletDevice) {
            cssParts.push('#sidebar { width: 260px !important; min-width: 200px !important; }');
            cssParts.push('#ctrls { gap: 4px !important; padding: 6px 8px !important; flex-wrap: wrap !important; }');
            cssParts.push('#ctrls button { padding: 6px 10px !important; font-size: 11px !important; min-height: 38px !important; }');
            cssParts.push('#ctrls select { padding: 4px 8px !important; font-size: 11px !important; min-height: 34px !important; }');
            cssParts.push('#vol-slider { width: 50px !important; }');
            cssParts.push('#pbar { height: 5px !important; min-height: 20px !important; }');
            cssParts.push('#pwrap { padding: 4px 10px !important; }');
            cssParts.push('#tlabel { font-size: 11px !important; min-width: 85px !important; }');
            cssParts.push('.v-item { padding: 8px 12px !important; font-size: 12px !important; min-height: 42px !important; }');
            cssParts.push('#search { padding: 8px 12px !important; font-size: 13px !important; min-height: 40px !important; }');
            cssParts.push('#side-hd { padding: 10px !important; }');
            cssParts.push('#info-bar { height: 38px !important; padding: 0 8px !important; }');
            cssParts.push('#ovl .pb { width: 65px !important; height: 65px !important; }');
            cssParts.push('#ovl .pb span { font-size: 30px !important; }');
        }

        var cssString = cssParts.join('');

        // ========== 构建 HTML 主体 ==========
        var htmlParts = [];
        htmlParts.push('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><title>百度网盘视频播放器</title>');
        htmlParts.push('<script src="' + hlsCdn1 + '" onerror="this.onerror=null;this.parentNode.insertBefore(document.createElement(\'script\'), this.nextSibling).src=\'' + hlsCdn2 + '\';this.onerror=null;this.parentNode.insertBefore(document.createElement(\'script\'), this.nextSibling).src=\'' + hlsCdn3 + '\'"><\/script>');
        htmlParts.push('<style>' + cssString + '</style></head><body>');
        htmlParts.push('<div id="sidebar"><div id="side-hd"><h2 id="folder-title"></h2><button id="fold-sidebar-btn" title="折叠侧边栏">◀</button></div><input id="search" placeholder="🔍 搜索视频..."><div id="vlist"></div></div>');
        htmlParts.push('<div id="resizer"></div>');
        htmlParts.push('<div id="main">');
        htmlParts.push('<div id="info-bar"><span id="info-text"></span><button id="copy-btn" title="复制视频链接">🔗 链接</button></div>');
        htmlParts.push('<div id="p-area"><video id="video" playsinline></video><div id="ovl"><div style="text-align:center;"><div class="pb"><span>▶</span></div><p id="ovl-text">点击开始播放</p></div></div></div>');
        htmlParts.push('<div id="pwrap"><div id="pbar"><div id="pfill"></div></div><span id="tlabel">0:00 / 0:00</span></div>');
        htmlParts.push('<div id="ctrls">');
        htmlParts.push('<button id="bprev">⏮ 上一个</button>');
        htmlParts.push('<button id="bnext">下一个 ⏭</button>');
        htmlParts.push('<span style="color:#555;font-size:11px;">|</span>');
        htmlParts.push('<span style="color:#888;font-size:11px;">倍速:</span>');
        htmlParts.push('<select id="speed-select"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option><option value="2.5">2.5x</option><option value="3">3x</option><option value="3.5">3.5x</option><option value="4">4x</option></select>');
        htmlParts.push('<span class="spacer"></span>');
        htmlParts.push('<div id="vol-row"><span id="vol-icon">🔊</span><input type="range" id="vol-slider" min="0" max="100" value="100"></div>');
        htmlParts.push('<span style="color:#555;font-size:11px;margin-left:4px;">|</span>');
        htmlParts.push('<span style="color:#888;font-size:11px;">清晰度:</span>');
        htmlParts.push('<select id="quality-select"><option value="360">360P</option><option value="480">480P</option><option value="720">720P</option><option value="1080" selected>1080P</option></select>');
        htmlParts.push('<span style="color:#555;font-size:11px;margin-left:4px;">|</span>');
        htmlParts.push('<button id="toggle-sidebar-btn" title="切换侧边栏">📖</button>');
        htmlParts.push('<button id="pip-btn" title="画中画">PiP</button>');
        htmlParts.push('<button id="fullscreen-btn" title="全屏">⛶</button>');
        htmlParts.push('</div></div>');
        htmlParts.push('<button id="unfold-sidebar" title="展开侧边栏">▶</button>');
        htmlParts.push('<div id="toast"></div>');
        htmlParts.push('<script>' + jsString + '<\/script>');
        htmlParts.push('</body></html>');

        return htmlParts.join('');
    }

    // ============ 创建打开按钮 ============
    function createOpenButton(videos, shareInfo, folderName) {
        var old = document.getElementById('bd-open-player-btn');
        if (old) old.remove();

        if (!videos || !videos.length) return;

        var isTabletDevice = isTablet();
        var btn = document.createElement('button');
        btn.id = 'bd-open-player-btn';
        btn.textContent = '🎬 播放 (' + videos.length + '个)';
        var padding = isTabletDevice ? '18px 36px' : '14px 24px';
        var fontSize = isTabletDevice ? '18px' : '14px';
        btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:' + padding + ';background:linear-gradient(135deg,#1890ff,#722ed1);color:#fff;border:none;border-radius:28px;font-size:' + fontSize + ';font-weight:bold;cursor:pointer;box-shadow:0 6px 24px rgba(24,144,255,0.5);transition:transform 0.2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;';

        btn.onmouseenter = function() { btn.style.transform = 'scale(1.05)'; };
        btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };
        btn.ontouchstart = function() { btn.style.transform = 'scale(0.95)'; };
        btn.ontouchend = function() { btn.style.transform = 'scale(1)'; };

        btn.onclick = function() {
            var finalVideos = videos;
            if (!finalVideos || !finalVideos.length) {
                var surId = getSurId();
                var cached = getCachedVideoList(surId);
                if (cached && cached.length) {
                    finalVideos = cached;
                } else {
                    var list = getCurrentList();
                    var fresh = filterVideos(list);
                    if (fresh.length) {
                        finalVideos = fresh;
                    }
                }
            }
            if (!finalVideos || !finalVideos.length) {
                alert('当前文件夹没有视频文件');
                return;
            }
            var html = buildPlayerPage(finalVideos, shareInfo, folderName);

            var win = window.open('', '_blank');
            if (win) {
                try {
                    win.document.write(html);
                    win.document.close();
                } catch (e) {
                    var blob = new Blob([html], {type: 'text/html;charset=utf-8'});
                    var url = URL.createObjectURL(blob);
                    win.location.href = url;
                    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
                }
            } else {
                alert('请允许浏览器打开新标签页。');
            }
        };

        document.body.appendChild(btn);
    }

    // ============ 主逻辑 ============
    function checkAndUpdate() {
        var list = getCurrentList();
        var videos = filterVideos(list);
        if (videos.length) {
            var surId = getSurId();
            localStorage.setItem('bd_video_cache_' + surId, JSON.stringify(videos));
        }

        var btn = document.getElementById('bd-open-player-btn');
        if (!videos.length) {
            if (btn) btn.remove();
            return;
        }

        var shareInfo = {
            uk: unsafeWindow.uk || '',
            sid: unsafeWindow.sid || '',
            sign: unsafeWindow.sign || '',
            ts: unsafeWindow.ts || '',
            token: unsafeWindow.jsToken || ''
        };

        if (!shareInfo.uk || !shareInfo.sid) {
            if (unsafeWindow.locals) {
                unsafeWindow.locals.get('share_uk', 'shareid', 'sign', 'timestamp', function(uk, sid, sign, ts) {
                    shareInfo.uk = uk || shareInfo.uk;
                    shareInfo.sid = sid || shareInfo.sid;
                    shareInfo.sign = sign || shareInfo.sign;
                    shareInfo.ts = ts || shareInfo.ts;
                    var folderName = getFolderName();
                    createOpenButton(videos, shareInfo, folderName);
                });
                return;
            }
        }
        var folderName = getFolderName();
        createOpenButton(videos, shareInfo, folderName);
    }

    function init() {
        cleanExpiredProgress();
        setTimeout(checkAndUpdate, 1500);
        window.addEventListener('hashchange', function() { setTimeout(checkAndUpdate, 800); });
        document.addEventListener('click', function(e) {
            var target = e.target.closest('[data-path], .file-item, [class*="file"], [class*="item"]');
            if (target) setTimeout(checkAndUpdate, 1200);
        });
        document.addEventListener('touchstart', function(e) {
            var target = e.target.closest('[data-path], .file-item, [class*="file"], [class*="item"]');
            if (target) setTimeout(checkAndUpdate, 1200);
        }, { passive: true });
        setInterval(checkAndUpdate, 3000);
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
