chrome.action.onClicked.addListener((tab) => {
  if (tab.url && (tab.url.includes("twitter.com") || tab.url.includes("x.com")) && tab.url.includes("/status/")) {
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractTweets
    }, (results) => {
      if (results && results[0] && results[0].result) {
        // 将包含URL和推文数组的完整对象存入本地
        chrome.storage.local.set({ extractedData: results[0].result }, () => {
          chrome.tabs.create({ url: 'reader.html' });
        });
      } else {
        console.log("未提取到内容，请等待页面加载完毕。");
      }
    });
  }
});

function extractTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  let tweets = [];
  
  articles.forEach(article => {
    if (article.querySelector('[data-testid="placementTracking"]')) return;

    // 提取文字
    const textElement = article.querySelector('[data-testid="tweetText"]');
    const textHTML = textElement ? textElement.innerHTML : "";

    // 提取图片
    const photoElements = article.querySelectorAll('[data-testid="tweetPhoto"] img');
    let mediaHTML = "";
    photoElements.forEach(img => {
      let highResSrc = img.src.replace(/name=[a-z0-9]+/, 'name=large');
      mediaHTML += `<img src="${highResSrc}">`;
    });

    // --- 新增提取：作者名字、推特账号(@xxx) ---
    const nameContainer = article.querySelector('[data-testid="User-Name"]');
    let authorName = "未知用户";
    let authorHandle = "";
    if (nameContainer) {
       // 推特的用户名区域通常包含多行文本，第一行是昵称，带 @ 的是账号
       const texts = nameContainer.innerText.split('\n');
       if (texts.length >= 1) authorName = texts[0];
       const handleStr = texts.find(t => t.startsWith('@'));
       if (handleStr) authorHandle = handleStr;
    }

    // --- 新增提取：头像 ---
    const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
    // 把 _normal 替换为 _bigger 可以获取稍微清晰一点的头像
    let authorAvatar = avatarImg ? avatarImg.src.replace('_normal', '_bigger') : "";

    // --- 新增提取：时间 ---
    const timeElement = article.querySelector('time');
    let postTime = "";
    if (timeElement && timeElement.getAttribute('datetime')) {
        // 将推特底层时间转化为你本地的易读时间格式
        const dt = new Date(timeElement.getAttribute('datetime'));
        postTime = dt.toLocaleString(); 
    }

    if (textHTML || mediaHTML) {
      tweets.push({
        authorName,
        authorHandle,
        authorAvatar,
        postTime,
        text: textHTML,
        media: mediaHTML
      });
    }
  });
  
  // 将当前页面的网址和推文一起返回
  return {
     url: window.location.href,
     tweets: tweets
  };
}