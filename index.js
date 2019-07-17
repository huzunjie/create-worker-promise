/**
 * @function createWorkerByUri
 * @description 通过地址创建 Worker（解决同域限制），如果是相对路径则直接创建，否则fetch拉取远程文件再创建。
 * @param  {String}   url 文件路径
 * @param  {Object}   worker options
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
const urlRegxp = /^((https?):)?\/\//;
export default function createWorkerByUri(url, options) {
  return new Promise(function(resolve, reject) {
    if(urlRegxp.test(url)) {
      fetch(url, {
        method: 'GET',
        headers: {},
        mode: 'cors'
      })
      .then(res => {
        if(res.status === 200) {
          return res.blob();
        }else {
          reject(res);
        }
      }).then(blob => {
        const blobUrl = window.URL.createObjectURL(blob);
        resolve(new Worker(blobUrl, options));
      }).catch(reject);
    } else {
      try{
        resolve(new Worker(url, options));
      }catch(e) {
        reject(e);
      }
    }
  });
}

/**
 * @function createWorkerByTxt
 * @description 通过传入worker的JS脚本内容创建Worker。
 * @param  {String}   txt worker内容
 * @param  {Object}   worker options
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
export function createWorkerByTxt(txt, options) {
  return new Promise(function(resolve, reject) {
    try{
      const workerJsBlob = new Blob([txt], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(workerJsBlob);
      resolve(new Worker(blobUrl, options));
    }catch(e) {
      reject(e);
    }
  });
}

/**
 * @function createWorkerByFun
 * @description 通过传入一个包含Worker内容体的函数来创建web worker。
 * @param  {Function}   fun 包含worker内容的函数
 * @param  {Object}   worker options
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
export function createWorkerByFun(fun, options) {
  if(!fun.constructor || fun.constructor !== Function) {
    throw new Error('createWorkerByFun 的第一个参数不是一个 function 。');
  }
  const body = fun.toString().replace(/^[^{]+{/, '').replace(/}$/, '');
  return createWorkerByTxt(body, options);
}

