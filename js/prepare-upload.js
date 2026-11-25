(function (root) {
  var MAX_VIDEO_SECONDS = 60;

  function videoLength(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement("video");
      function finish(value) {
        URL.revokeObjectURL(url);
        video.removeAttribute("src");
        resolve(value);
      }
      video.preload = "metadata";
      video.onloadedmetadata = function () { finish(Number(video.duration) || 0); };
      video.onerror = function () { finish(0); };
      video.src = url;
    });
  }

  function prepareShareFile(file) {
    if (!file) return Promise.resolve(file);
    if (String(file.type || "").indexOf("video/") === 0) {
      return videoLength(file).then(function (seconds) {
        if (seconds > MAX_VIDEO_SECONDS + 0.4) {
          throw new Error("Videos can be up to 1 minute. Choose a shorter clip.");
        }
        return file;
      });
    }
    return Promise.resolve(file);
  }

  root.prepareShareFile = prepareShareFile;
})(window);
