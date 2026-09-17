```javascript
// ==UserScript==
// @name         百度网盘 - 去除 # 后新标签页打开（Firefox）
// @namespace    https://tampermonkey.net/
// @version      2.0
// @description  百度网盘视频跳转后，自动去掉 # 及后面的内容，并在新标签页打开干净 URL
// @match        https://pan.baidu.com/*
// @run-at       document-start
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    let processing = false;
    let lastUrl = location.href;

    /**
     * 检测 URL 是否包含 #
     */
    function checkUrl() {

        if (processing) {
            return;
        }

        const currentUrl = location.href;

        // URL 没有变化
        if (currentUrl === lastUrl) {
            return;
        }

        lastUrl = currentUrl;

        // 没有 #，不处理
        if (!currentUrl.includes('#')) {
            return;
        }

        // 获取 # 前面的 URL
        const cleanUrl = currentUrl.split('#')[0];

        if (!cleanUrl) {
            return;
        }

        // 防止重复
        if (cleanUrl === currentUrl) {
            return;
        }

        processing = true;

        console.log('[百度网盘] 检测到 URL 变化');
        console.log('[百度网盘] 原 URL:', currentUrl);
        console.log('[百度网盘] 干净 URL:', cleanUrl);

        /**
         * Firefox + Tampermonkey/Violentmonkey
         * 使用 GM_openInTab 创建新标签页
         */
        const newTab = GM_openInTab(cleanUrl, {
            active: true,
            insert: true,
            setParent: true
        });

        /**
         * 尝试关闭当前标签页
         *
         * Firefox 对 window.close() 有安全限制。
         * 如果当前页面不是脚本创建的标签页，
         * 浏览器可能拒绝关闭。
         */
        setTimeout(function () {

            try {
                window.close();
            } catch (e) {
                console.log('[百度网盘] Firefox 阻止关闭原标签页');
            }

        }, 500);
    }


    /**
     * 监听 hash 变化
     */
    window.addEventListener('hashchange', function () {

        setTimeout(function () {
            checkUrl();
        }, 100);

    });


    /**
     * 监听页面历史记录变化
     *
     * 百度网盘属于 SPA，
     * 可能通过 pushState / replaceState 修改 URL。
     */

    const originalPushState = history.pushState;

    history.pushState = function () {

        const result = originalPushState.apply(this, arguments);

        setTimeout(function () {
            checkUrl();
        }, 100);

        return result;
    };


    const originalReplaceState = history.replaceState;

    history.replaceState = function () {

        const result = originalReplaceState.apply(this, arguments);

        setTimeout(function () {
            checkUrl();
        }, 100);

        return result;
    };


    /**
     * 备用检测
     *
     * 防止百度网盘使用其他方式修改 URL。
     */
    setInterval(function () {

        if (location.href !== lastUrl) {
            checkUrl();
        }

    }, 300);

})();
```
