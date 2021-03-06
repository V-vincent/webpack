(function (global) {
	// 启动模块加载器
	var myModule = global.myModule = {
		version: "1.0.1",
	}
	var data = {}; // 数据的信息 配置
	var cache = {};
	var anonymousMeta = {};
	// 模块的生命周期
	var status = {
		FETCHED: 1,
		SAVED: 2,
		LOADING: 3,
		LOADED: 4,
		EXECUTING: 5,
		EXECUTED: 6,
	}

	var isArray = function (obj) {
		return toString.call(obj) === "[object Array]";
	}

	var isFunction = function (obj) {
		return toString.call(obj) === "[object Function]";
	}

	var isString = function (obj) {
		return toString.call(obj) === "[object String]";
	}

	// 是否使用了别名
	function parseAlias(id) { // a  b
		var alias = data.alias; // 配置  {a:"common/js/a", b:"common/js/b"}
		return alias && isString(alias[id]) ? alias[id] : id;
	}

	// 不能以"/" ":"开头  结尾必须是一个"/" 后面跟随任意字符至少一个
	var PATHS_RE = /^([^\/:]+)(\/.+)$/; //([^\/:]+)   路径的短名称配置

	// 检测是否 书写路径短名称
	function parsePaths(id) {
		var paths = data.paths; // 配置
		if (paths && (m = id.match(PATHS_RE)) && isString(paths[m[1]])) {
			id = paths[m[1]] + m[2]
		}
		return id;
	}

	// 检测是否添加后缀
	function normalize(path) {
		var last = path.length - 1;
		var lastC = path.charAt(last);
		return (lastC === "/" || path.substring(last - 2) === ".js") ? path : path + ".js";

	}
	// 检测是否设置了data-main属性
	function parseDataMain(id) {
		var alias = data.alias;
		var dataMain = data.dataMain;
		if (alias && isString(alias[id])) return id; // 如果同时配置了alias/path和data-main的值，以alias的值为主
		return dataMain ? dataMain + id : id;
	}

	function scripts() {
		return document.getElementsByTagName('script');
	}

	function eachReverse(ary, func) {
		if (ary) {
			var i;
			for (i = ary.length - 1; i > -1; i -= 1) {
				if (ary[i] && func(ary[i], i, ary)) {
					break;
				}
			}
		}
	}
	eachReverse(scripts(), function (script) {
		var dataMain = script.getAttribute('data-main'); // 获取data-main属性
		if (dataMain) {
			dataMain = dataMain.replace(/\s*/g, ""); // 移除空格
			if (dataMain.charAt(dataMain.length - 1) != '/') {
				dataMain = dataMain + '/';
			}
			data.dataMain = dataMain; // 设置data-main的内存
		}
	});

	// 添加根目录
	function addBase(id, uri) {
		var result;
		if (id.charAt(0) === ".") {
			result = relapath((uri ? uri.match(/[^?]*\//)[0] : data.cwd) + id);
		} else {
			result = data.cwd + id;
		}
		return result;
	}

	var DOT_RE = /\/.\//g; // 规范路径  "/./" => "/"   
	function relapath(path) {
		path = path.replace(DOT_RE, "/");
		return path;
	}

	//child  "a.js"  require("a");      配置项
	myModule.resolve = function (child, parent) {
		if (!child) return "";
		child = parseDataMain(child); // 检测是否设置了data-main属性
		child = parseAlias(child); // 检测是否有别名  a ===  "common/js/a"    b === "common/js/b"
		child = parsePaths(child); // 检测是否有路径别名 依赖模块中引包的模块路径地址 require("app/c");
		child = normalize(child); // 检测是否添加后缀 a === "common/js/a.js"  b === "common/js/b.js"
		return addBase(child, parent); //添加根目录  项目的绝对路径为基准  data.cwd+ "common/js/a.js"
	}

	myModule.request = function (url, callback) {
		var node = document.createElement("script");
		node.src = url;
		document.body.appendChild(node);
		node.onload = function () {
			// node.onload = null;
			// document.body.removeChild(node); 
			callback();
		}
	}

	// 构造函数  模块初始化数据
	function Module(uri, deps) {
		this.uri = uri;
		this.deps = deps || [];
		this.exports = null;
		this.status = 0;
		this._waitings = {};
		this._remain = 0;
	}

	// 分析主干 (左子树 | 右子树) 上的依赖项
	Module.prototype.load = function () {
		var module = this;
		module.status = status.LOADING;
		var uris = module.resolve(); // 获取主干上的依赖项
		var len = module._remain = uris.length;
		// console.log(uris)
		// 加载主干上的依赖项(模块)
		var m;
		for (var i = 0; i < len; i++) {
			m = Module.get(uris[i]); // 创建缓存信息
			if (m.status < status.LOADED) {
				m._waitings[module.uri] = m._waitings[module.uri] || 1;
			} else {
				module._remain--;
			}
		}
		// 如果依赖列表模块全都加载完毕 
		// 在上节课中我们知道load这个方法会递归调用  第一次调用 load  module 会指向 主干上的Module实例对象
		// 第二次三次调用load  module 会指向 主干上的a.js  b.js Module实例对象
		if (module._remain == 0) {
			module.onload();
		};

		// 准备执行根目录下的依赖列表中的模块
		var requestCache = {};
		for (var i = 0; i < len; i++) {
			m = Module.get(uris[i]);
			if (m.status < status.FETCHED) {
				m.fetch(requestCache);
			}
		}

		for (uri in requestCache) {
			requestCache[uri]();
		}
	}

	// 加载依赖列表中的模块
	Module.prototype.fetch = function (requestCache) {
		var module = this;
		module.status = status.FETCHED;
		var uri = module.uri;
		requestCache[uri] = sendRequest; // Document.createElement("script") 

		function sendRequest() {
			myModule.request(uri, onRequest);
		}

		function onRequest() {
			if (anonymousMeta) {
				module.save(uri, anonymousMeta);
			}
			module.load(); // 递归 模块加载策略
		}
	}

	Module.prototype.onload = function () {
		// console.log(mod)
		var mod = this;
		mod.status = status.LOADED;
		if (mod.callback) {
			mod.callback();
		}
		// 伪递归
		_waitings = mod._waitings;
		var uri, m;
		for (uri in _waitings) {
			m = cache[uri];

			m._remain -= _waitings[uri];
			if (m._remain == 0) {
				m.onload()
			};
		}

	}

	// 更改初始化数据 
	Module.prototype.save = function (uri, meta) {
		var module = Module.get(uri); //是否在缓存
		module.id = uri;
		module.deps = meta.deps || [];
		module.factory = meta.factory;
		module.status = status.SAVED;
	}

	// 获取模块对外的接口对象
	Module.prototype.exec = function () {
		var module = this;
		// 防止重复执行
		if (module.status >= status.EXECUTING) {
			return module.exports;
		}
		module.status = status.EXECUTING; //5
		var uri = module.uri;

		function require(id) {
			// console.log(require.resolve(id));   // 更新过后的数据
			return Module.get(require.resolve(id)).exec(); // 获取接口对象
		}

		require.resolve = function (id) {
			return myModule.resolve(id, uri);
		}

		var factory = module.factory;
		var exports = isFunction(factory) ? factory(require, module.exports = {}, module) : factory;

		if (exports === undefined) {
			exports = module.exports;
		}
		module.exports = exports;
		module.status = status.EXECUTED;
		return exports;
	}

	// 资源定位 解析依赖项生成绝对路径
	Module.prototype.resolve = function () {
		var mod = this;
		var ids = mod.deps; //["./a","./b"]
		var uris = [];
		for (var i = 0; i < ids.length; i++) {
			uris[i] = myModule.resolve(ids[i], mod.uri); //依赖项   (主干| 子树)
		}
		return uris;
	}

	// 定义一个模块
	Module.define = function (factory) {
		var deps;
		if (isFunction(factory)) {
			// 正则解析依赖项
			deps = parseDependencies(factory.toString());
		}
		// 存储当前模块的信息
		var meta = {
			id: "",
			uri: "",
			deps: deps,
			factory: factory
		}
		anonymousMeta = meta;
	}

	// 检测缓存对象上是否有当前模块信息
	Module.get = function (uri, deps) {
		return cache[uri] || (cache[uri] = new Module(uri, deps));
	}

	Module.use = function (deps, callback, uri) {
		var module = Module.get(uri, isArray(deps) ? deps : [deps]);
		// 所有模块都加载完毕
		module.callback = function () {
			var exports = []; // 所以依赖项模块的接口对象
			var uris = module.resolve();
			for (var i = 0; i < uris.length; i++) {
				exports[i] = cache[uris[i]].exec(); // 获取模块对外定义的接口对象
			}
			if (callback) {
				callback.apply(global, exports);
			}
		}
		module.load();
	}

	var _cid = 0;

	function cid() {
		return _cid++;
	};

	data.preload = [];
	// 获取当前项目文档的URL
	data.cwd = document.URL.match(/[^?]*\//)[0];
	Module.preload = function (callback) {
		var preloadMods = data.preload || [];
		var length = preloadMods.length;
		if (length) {
			Module.use(preloadMods, function () {
				preloadMods.splice(0, length);
				callback();
			}, data.cwd + "_preload_" + cid()); // 虚拟的根目录
		} else {
			callback();
		}

	};

	myModule.use = function (list, callback) {
		// 检测有没有预先加载的模块  
		Module.preload(function () {
			Module.use(list, callback, data.cwd + "_use_" + cid()); // 虚拟的根目录
		});
	}

	myModule.config = function (options) {
		var key;
		for (key in options) {
			data[key] = options[key];
		}
	}
	// 注释中的 require("c")  剔除
	var REQUIRE_RE = /\brequire\s*\(\s*(["'])(.+?)\1\s*\)/g

	function parseDependencies(code) {
		var ret = []
		code.replace(REQUIRE_RE, function (m, m1, m2) {
			if (m2) ret.push(m2);
		});
		return ret
	};

	global.define = Module.define;
})(this);