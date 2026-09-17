// ==UserScript==
// @name         百度网盘：自动去除 # 并新标签打开
// @namespace    https://pan.baidu.com/
// @version      2.0
// @description  百度网盘平板播放列表自动去除 # 路由，并在新标签页打开干净 URL
// @match        https://pan.baidu.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ==============================
     * 配置
     * ==============================
     */

    // 新页面打开后，最多等待多久再关闭旧页面
    const CLOSE_DELAY = 1500;

    // 页面完全加载后再检查
    const CHECK_DELAY = 1000;


    /*
     * ==============================
     * 防止死循环
     * ==============================
     *
     * 新页面打开时，在 URL 中增加一个临时标记：
     *
     * ?_tm_baidu_clean=1
     *
     * 新页面发现这个标记后：
     *
     * 1. 不再执行跳转
     * 2. 立即把地址栏里的这个临时参数删除
     *
     * 因此最终地址仍然恢复成原来的干净 URL。
     */

    const FLAG = '_tm_baidu_clean';

    const url = new URL(window.location.href);

    // 如果这是脚本打开的新页面
    if (url.searchParams.get(FLAG) === '1') {

        console.log('[百度网盘] 新页面，跳过自动处理');

        // 删除临时参数
        url.searchParams.delete(FLAG);

        // 保留真正的 URL
        history.replaceState(
            null,
            '',
            url.pathname + '?' + url.searchParams.toString()
        );

        return;
    }


    /*
     * ==============================
     * 页面完全加载后检查
     * ==============================
     */

    window.addEventListener('load', function () {

        setTimeout(function () {

            const currentUrl = window.location.href;

            console.log('[百度网盘] 页面加载完成');
            console.log('[百度网盘] 当前地址：', currentUrl);


            /*
             * 没有 #
             * 什么都不做
             */

            if (!window.location.hash) {

                console.log('[百度网盘] 没有 #，无需处理');

                return;
            }


            /*
             * ==============================
             * 获取 # 前面的完整 URL
             * ==============================
             */

            const hashIndex = currentUrl.indexOf('#');

            if (hashIndex === -1) {
                return;
            }

            // 完全保留 # 前面的内容
            const cleanUrl = currentUrl.substring(0, hashIndex);

            console.log('[百度网盘] 检测到 #');
            console.log('[百度网盘] 原地址：', currentUrl);
            console.log('[百度网盘] 干净地址：', cleanUrl);


            /*
             * ==============================
             * 给新页面增加一次性标记
             * ==============================
             */

            const newUrl = new URL(cleanUrl);

            newUrl.searchParams.set(FLAG, '1');


            /*
             * ==============================
             * 打开新标签页
             * ==============================
             */

            console.log('[百度网盘] 正在打开新标签页...');

            GM_openInTab(newUrl.toString(), {
                active: true,
                insert: true,
                setParent: true
            });


            /*
             * ==============================
             * 关闭旧页面
             * ==============================
             */

            setTimeout(function () {

                console.log('[百度网盘] 尝试关闭旧标签页');

                window.close();

            }, CLOSE_DELAY);


        }, CHECK_DELAY);

    }, { once: true });

})();
