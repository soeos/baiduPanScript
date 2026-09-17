// ==UserScript==
// @name         百度网盘加载完成后去除 # 并新开标签页
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  页面完全加载后，如果 URL 存在 #，打开去掉 # 的新标签页并关闭当前标签页
// @match        https://pan.baidu.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    // 防止新标签页再次触发脚本，造成死循环
    const FLAG = 'tm_cleaned=1';

    // 如果当前 URL 已经带有处理标记，直接退出
    if (new URLSearchParams(window.location.search).has(FLAG.split('=')[0])) {
        console.log('[百度网盘] 已处理过，不再执行');
        return;
    }

    // 页面完全加载后执行
    window.addEventListener('load', function () {

        // 再等待一下，确保百度网盘前端路由已经完成
        setTimeout(function () {

            const currentUrl = window.location.href;

            console.log('[百度网盘] 页面加载完成');
            console.log('[百度网盘] 当前 URL:', currentUrl);

            // 没有 #，什么都不做
            if (!window.location.hash) {
                console.log('[百度网盘] 没有 #，不处理');
                return;
            }

            // 去掉 # 以及后面的 Fragment
            const hashIndex = currentUrl.indexOf('#');

            if (hashIndex === -1) {
                return;
            }

            let cleanUrl = currentUrl.substring(0, hashIndex);

            // 加入一次性标记，防止新标签页再次执行
            cleanUrl += (cleanUrl.includes('?') ? '&' : '?') + FLAG;

            console.log('[百度网盘] 检测到 #');
            console.log('[百度网盘] 新标签页:', cleanUrl);

            // 打开新的标签页
            const newTab = GM_openInTab(cleanUrl, {
                active: true,
                insert: true,
                setParent: true
            });

            // 稍微等待新标签页打开，然后关闭当前标签页
            setTimeout(function () {
                try {
                    window.close();
                } catch (e) {
                    console.log('[百度网盘] 当前标签页无法自动关闭:', e);
                }
            }, 1000);

        }, 1000);

    }, { once: true });

})();
