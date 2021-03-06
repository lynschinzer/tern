(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    return mod(require("../infer"), require("../tern"), require);
  if (typeof define == "function" && define.amd) // AMD
    return define(["../infer", "../tern"], mod);
  mod(tern, tern);
})(function(infer, tern, require) {
  "use strict";

  function resolvePath(base, path) {
    var slash = base.lastIndexOf("/"), m;
    if (slash >= 0) path = base.slice(0, slash + 1) + path;
    while (m = /[^\/]*[^\/\.][^\/]*\/\.\.\//.exec(path))
      path = path.slice(0, m.index) + path.slice(m.index + m[0].length);
    return path.replace(/(^|[^\.])\.\//g, "$1");
  }

  function getModule(data, name) {
    return data.modules[name] || (data.modules[name] = new infer.AVal);
  }

  function buildWrappingScope(parent, origin, node) {
    var scope = new infer.Scope(parent);
    scope.node = node;
    infer.def.parsePath("node.require").propagate(scope.defProp("require"));
    var module = infer.getInstance(infer.def.parsePath("node.Module.prototype").getType());
    module.propagate(scope.defProp("module"));
    var exports = new infer.Obj(true, "exports", origin);
    exports.propagate(scope.defProp("exports"));
    exports.propagate(module.defProp("exports"));
    return scope;
  }

  function exportsFromScope(scope) {
    var exportsVal = scope.getProp("module").getType().getProp("exports");
    if (!(exportsVal instanceof infer.AVal))
      return file.scope.getProp("exports");
    else
      return exportsVal.types[exportsVal.types.length - 1];
  }

  function resolveModule() { return infer.ANull; }

  // Assume node.js & access to local file system
  if (require) (function() {
    var fs = require("fs"), path = require("path");

    function findModuleDir(server) {
      if (server._node.moduleDir !== undefined) return server._node.moduleDir;

      for (var dir = server.options.projectDir || "";;) {
        var modDir = path.resolve(dir, "node_modules");
        try {
          if (fs.statSync(modDir).isDirectory()) return server._node.moduleDir = modDir;
        } catch(e) {}
        var end = dir.lastIndexOf("/");
        if (end <= 0) return server._node.moduleDir = null;
        dir = dir.slice(0, end);
      }
    }

    resolveModule = function(server, name) {
      var data = server._node;
      if (data.options.dontLoad == true ||
          data.options.dontLoad && new RegExp(data.options.dontLoad).test(name) ||
          data.options.load && !new RegExp(data.options.load).test(name))
        return infer.ANull;

      var modDir = findModuleDir(server);
      if (!modDir) return infer.ANull;

      var file = name;
      if (name.indexOf("/") < 0) {
        try {
          var pkg = JSON.parse(fs.readFileSync(path.resolve(modDir, name + "/package.json")));
        } catch(e) { return infer.ANull; }
        file = name + "/" + pkg.main;
      }
      if (!/\.js$/.test(file)) file += ".js";

      file = path.resolve(modDir, file);
      if (!fs.existsSync(file)) return infer.ANull;
      server.addFile(file);
      return data.modules[file] = data.modules[name] = new infer.AVal;
    };
  })();

  infer.registerFunction("nodeRequire", function(_self, _args, argNodes) {
    if (!argNodes || !argNodes.length || argNodes[0].type != "Literal" || typeof argNodes[0].value != "string")
      return infer.ANull;
    var cx = infer.cx(), server = cx.parent, data = server._node, name = argNodes[0].value;
    var node = cx.topScope.getProp("node").getType(), val;
    if (name != "Module" && node.props && (val = node.props[name]))
      return val;

    if (/^\.{0,2}\//.test(name)) { // Relative
      if (!data.currentFile) return argNodes[0].required || infer.ANull;
      if (!/\.[^\/]*$/.test(name)) name = name + ".js";
      name = resolvePath(data.currentFile, name);
      server.addFile(name);
      return argNodes[0].required = getModule(data, name);
    }

    if (name in data.modules) return data.modules[name];

    if (data.options.modules && data.options.modules.hasOwnProperty(name)) {
      var scope = buildWrappingScope(cx.topScope, name);
      infer.def.load(data.options.modules[name], scope);
      return data.modules[name] = exportsFromScope(scope);
    } else {
      return resolveModule(server, name);
    }
  });

  tern.registerPlugin("node", function(server, options) {
    server._node = {
      modules: Object.create(null),
      options: options || {},
      currentFile: null,
      server: server
    };

    server.on("beforeLoad", function(file) {
      this._node.currentFile = file.name;
      file.scope = buildWrappingScope(file.scope, file.name, file.ast);
    });

    server.on("afterLoad", function(file) {
      this._node.currentFile = null;
      exportsFromScope(file.scope).propagate(getModule(this._node, file.name));
    });

    server.on("reset", function(file) {
      this._node.modules = Object.create(null);
    });

    return {defs: defs};
  });

  var defs = {
    "!name": "node",

    "!define": {
      EventEmitter: "node.events.EventEmitter",
      "os.cpuSpec": {
        model: "string",
        speed: "number",
        times: {
          user: "number",
          nice: "number",
          sys: "number",
          idle: "number",
          irq: "number"
        }
      },
      "process.memoryUsage.type": {
        rss: "number",
        heapTotal: "?",
        number: "?",
        heapUsed: "number"
      },
      "net.address": {
        port: "number",
        family: "string",
        address: "string"
      },
      "url.type": {
        href: "string",
        protocol: "string",
        auth: "string",
        hostname: "string",
        port: "string",
        host: "string",
        pathname: "string",
        search: "string",
        query: "string",
        slashes: "bool",
        hash: "string"
      },
      "tls.Server.credentials": {
        key: "string",
        cert: "string",
        ca: "string"
      },
      "tls.cipher": {
        name: "string",
        version: "string"
      },
      "crypto.credentials": {
        pfx: "string",
        key: "string",
        passphrase: "string",
        cert: "string",
        ca: "string",
        crl: "string",
        ciphers: "string"
      }
    },

    process: {
      stdout: "+node.stream.Writable",
      stderr: "+node.stream.Writable",
      stdin: "+node.stream.Readable",
      argv: "[string]",
      execPath: "string",
      abort: "fn()",
      chdir: "fn(directory: string)",
      cwd: "fn()",
      env: {},
      exit: "fn(code?: number)",
      getgid: "fn() -> number",
      setgid: "fn(id: number)",
      getuid: "fn() -> number",
      setuid: "fn(id: number)",
      version: "string",
      versions: {
        http_parser: "string",
        node: "string",
        v8: "string",
        ares: "string",
        uv: "string",
        zlib: "string",
        openssl: "string"
      },
      config: {
        target_defaults: {
          cflags: "[?]",
          default_configuration: "string",
          defines: "[string]",
          include_dirs: "[string]",
          libraries: "[string]"
        },
        variables: {
          clang: "number",
          host_arch: "string",
          node_install_npm: "bool",
          node_install_waf: "bool",
          node_prefix: "string",
          node_shared_openssl: "bool",
          node_shared_v8: "bool",
          node_shared_zlib: "bool",
          node_use_dtrace: "bool",
          node_use_etw: "bool",
          node_use_openssl: "bool",
          target_arch: "string",
          v8_no_strict_aliasing: "number",
          v8_use_snapshot: "bool",
          visibility: "string"
        }
      },
      kill: "fn(pid: number, signal?: string)",
      pid: "number",
      title: "string",
      arch: "string",
      platform: "string",
      memoryUsage: "fn() -> process.memoryUsage.type",
      nextTick: "fn(callback: fn())",
      umask: "fn(mask?: number) -> number",
      uptime: "fn() -> number",
      hrtime: "fn() -> [number]"
    },
    global: "<top>",
    console: {
      log: "fn(text: string)",
      info: "fn(text: string)",
      error: "fn(text: string)",
      warn: "fn(text: string)",
      dir: "fn(obj: ?)",
      timeEnd: "fn(label: string)",
      trace: "fn(label: string)",
      assert: "fn(expression: bool)"
    },
    __filename: "string",
    __dirname: "string",
    setTimeout: "fn(callback: fn(), ms: number) -> ?",
    clearTimeout: "fn(timeoutId: ?)",
    setInterval: "fn(callback: fn(), ms: number) -> ?",
    clearInterval: "fn(intervalId: ?)",
    Buffer: {
      "!type": "fn(str: string, encoding?: string) -> +Buffer",
      prototype: {
        "!proto": "String.prototype",
        write: "fn(string: string, offset?: number, length?: number, encoding?: string) -> number",
        toString: "fn(encoding?: string, start?: number, end?: number) -> string",
        length: "number",
        copy: "fn(targetBuffer: +Buffer, targetStart?: number, sourceStart?: number, sourceEnd?: number)",
        slice: "fn(start?: number, end?: number) -> +Buffer",
        readUInt8: "fn(offset: number, noAsset?: bool) -> number",
        readUInt16LE: "fn(offset: number, noAssert?: bool) -> number",
        readUInt16BE: "fn(offset: number, noAssert?: bool) -> number",
        readUInt32LE: "fn(offset: number, noAssert?: bool) -> number",
        readUInt32BE: "fn(offset: number, noAssert?: bool) -> number",
        readInt8: "fn(offset: number, noAssert?: bool) -> number",
        readInt16LE: "fn(offset: number, noAssert?: bool) -> number",
        readInt16BE: "fn(offset: number, noAssert?: bool) -> number",
        readInt32LE: "fn(offset: number, noAssert?: bool) -> number",
        readInt32BE: "fn(offset: number, noAssert?: bool) -> number",
        readFloatLE: "fn(offset: number, noAssert?: bool) -> number",
        readFloatBE: "fn(offset: number, noAssert?: bool) -> number",
        readDoubleLE: "fn(offset: number, noAssert?: bool) -> number",
        readDoubleBE: "fn(offset: number, noAssert?: bool) -> number",
        writeUInt8: "fn(value: number, offset: number, noAssert?: bool)",
        writeUInt16LE: "fn(value: number, offset: number, noAssert?: bool)",
        writeUInt16BE: "fn(value: number, offset: number, noAssert?: bool)",
        writeUInt32LE: "fn(value: number, offset: number, noAssert?: bool)",
        writeUInt32BE: "fn(value: number, offset: number, noAssert?: bool)",
        writeInt8: "fn(value: number, offset: number, noAssert?: bool)",
        writeInt16LE: "fn(value: number, offset: number, noAssert?: bool)",
        writeInt16BE: "fn(value: number, offset: number, noAssert?: bool)",
        writeInt32LE: "fn(value: number, offset: number, noAssert?: bool)",
        writeInt32BE: "fn(value: number, offset: number, noAssert?: bool)",
        writeFloatLE: "fn(value: number, offset: number, noAssert?: bool)",
        writeFloatBE: "fn(value: number, offset: number, noAssert?: bool)",
        writeDoubleLE: "fn(value: number, offset: number, noAssert?: bool)",
        writeDoubleBE: "fn(value: number, offset: number, noAssert?: bool)",
        fill: "fn(value: ?, offset?: number, end?: number)",
        INSPECT_MAX_BYTES: "number"
      },
      isBuffer: "fn(obj: ?) -> bool",
      byteLength: "fn(string: string, encoding?: string) -> number",
      concat: "fn(list: [+Buffer], totalLength?: number) -> +Buffer"
    },

    node: {
      require: {
        "!type": "fn(id: string) -> $custom:nodeRequire",
        resolve: "fn() -> string",
        cache: {},
        extensions: {}
      },
      Module: {
        "!type": "fn()",
        prototype: {
          exports: "?",
          require: "node.require",
          id: "string",
          filename: "string",
          loaded: "bool",
          parent: "+node.Module",
          children: "[+node.Module]"
        }
      },
      events: {
        EventEmitter: {
          prototype: {
            addListener: "fn(event: string, listener: fn())",
            on: "fn(event: string, listener: fn())",
            once: "fn(event: string, listener: fn())",
            removeListener: "fn(event: string, listener: fn())",
            removeAllListeners: "fn(event: string)",
            setMaxListeners: "fn(n: number)",
            listeners: "fn(event: string) -> [fn()]",
            emit: "fn(event: string)"
          }
        }
      },
      stream: {
        "!type": "fn()",
        prototype: {
          "!proto": "EventEmitter.prototype",
          pipe: "fn(destination: +node.stream.Writable, options?: ?)"
        },
        Writable: {
          "!type": "fn(options?: ?)",
          prototype: {
            "!proto": "node.stream.prototype",
            write: "fn(chunk: +Buffer, encoding?: string, callback?: fn()) -> bool",
            end: "fn(chunk: +Buffer, encoding?: string, callback?: fn()) -> bool"
          }
        },
        Readable: {
          "!type": "fn(options?: ?)",
          prototype: {
            "!proto": "node.stream.prototype",
            setEncoding: "fn(encoding: string)",
            pause: "fn()",
            resume: "fn()",
            destroy: "fn()",
            unpipe: "fn(dest?: +node.stream.Writable)",
            push: "fn(chunk: +Buffer) -> bool",
            unshift: "fn(chunk: +Buffer) -> bool",
            wrap: "fn(stream: ?) -> +node.stream.Readable",
            read: "fn(size?: number) -> +Buffer"
          }
        },
        Duplex: {
          "!type": "fn(options?: ?)",
          prototype: {
            "!proto": "node.stream.Readable.prototype",
            write: "fn(chunk: +Buffer, encoding?: string, callback?: fn()) -> bool",
            end: "fn(chunk: +Buffer, encoding?: string, callback?: fn()) -> bool"
          }
        },
        Transform: {
          "!type": "fn(options?: ?)",
          prototype: {
            "!proto": "node.stream.Duplex.prototype"
          }
        },
        PassThrough: "node.stream.Transform"
      },
      querystring: {
        stringify: "fn(obj: ?, sep?: string, eq?: string) -> string",
        parse: "fn(str: string, sep?: string, eq?: string, options?: ?) -> ?",
        escape: "fn(string) -> string",
        unescape: "fn(string) -> string"
      },
      http: {
        STATUS_CODES: {},
        createServer: "fn(listener?: fn(request: +node.http.IncomingMessage, response: +node.http.ServerResponse)) -> +node.http.Server",
        Server: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            listen: "fn(port: number, hostname?: string, backlog?: number, callback?: fn())",
            close: "fn(callback?: ?)",
            maxHeadersCount: "number",
            setTimeout: "fn(timeout: number, callback?: fn())",
            timeout: "number"
          }
        },
        ServerResponse: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Writable.prototype",
            writeContinue: "fn()",
            writeHead: "fn(statusCode: number, headers?: ?)",
            setTimeout: "fn(timeout: number, callback?: fn())",
            statusCode: "number",
            setHeader: "fn(name: string, value: string)",
            headersSent: "bool",
            sendDate: "bool",
            getHeader: "fn(name: string) -> string",
            removeHeader: "fn(name: string)",
            addTrailers: "fn(headers: ?)"
          }
        },
        request: "fn(options: ?, callback?: fn(res: +node.http.IncomingMessage)) -> +node.http.ClientRequest",
        get: "fn(options: ?, callback?: fn(res: +node.http.IncomingMessage)) -> +node.http.ClientRequest",
        globalAgent: "+node.http.Agent",
        Agent: {
          "!type": "fn()",
          prototype: {
            maxSockets: "number",
            sockets: "[+node.net.Socket]",
            requests: "[+node.http.ClientRequest]"
          }
        },
        ClientRequest: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Writable.prototype",
            abort: "fn()",
            setTimeout: "fn(timeout: number, callback?: fn())",
            setNoDelay: "fn(noDelay?: fn())",
            setSocketKeepAlive: "fn(enable?: bool, initialDelay?: number)"
          }
        },
        IncomingMessage: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Readable.prototype",
            httpVersion: "string",
            headers: "?",
            trailers: "?",
            setTimeout: "fn(timeout: number, callback?: fn())",
            setEncoding: "fn(encoding?: string)",
            pause: "fn()",
            resume: "fn()",
            method: "string",
            url: "string",
            statusCode: "number",
            socket: "+node.net.Socket"
          }
        }
      },
      https: {
        Server: "node.http.Server",
        createServer: "fn(listener?: fn(request: +node.http.IncomingMessage, response: +node.http.ServerResponse)) -> +node.https.Server",
        request: "fn(options: ?, callback?: fn(res: +node.http.IncomingMessage)) -> +node.http.ClientRequest",
        get: "fn(options: ?, callback?: fn(res: +node.http.IncomingMessage)) -> +node.http.ClientRequest",
        Agent: "node.http.Agent",
        globalAgent: "node.http.globalAgent"
      },
      cluster: {
        "!proto": "EventEmitter.prototype",
        settings: {
          exec: "string",
          args: "[string]",
          silent: "bool"
        },
        Worker: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            id: "string",
            process: "+node.child_process.ChildProcess",
            suicide: "bool",
            send: "fn(message: ?, sendHandle?: ?)",
            destroy: "fn()",
            disconnect: "fn()"
          }
        },
        isMaster: "bool",
        isWorker: "bool",
        setupMaster: "fn(settings?: node.cluster.settings)",
        fork: "fn(env?: ?) -> +node.cluster.Worker",
        disconnect: "fn(callback?: fn())",
        worker: "+node.cluster.Worker",
        workers: "[+node.cluster.Worker]"
      },
      zlib: {
        Zlib: {
          "!type": "fn()",
          prototype: "node.zlib"
        },
        deflate: "fn(buf: +Buffer, callback: fn())",
        deflateRaw: "fn(buf: +Buffer, callback: fn())",
        gzip: "fn(buf: +Buffer, callback: fn())",
        gunzip: "fn(buf: +Buffer, callback: fn())",
        inflate: "fn(buf: +Buffer, callback: fn())",
        inflateRaw: "fn(buf: +Buffer, callback: fn())",
        unzip: "fn(buf: +Buffer, callback: fn())",
        Gzip: "node.zlib.Zlib",
        createGzip: "fn(options: ?) -> +node.zlib.Gzip",
        Gunzip: "node.zlib.Zlib",
        createGunzip: "fn(options: ?) -> +node.zlib.Gunzip",
        Deflate: "node.zlib.Zlib",
        createDeflate: "fn(options: ?) -> +node.zlib.Deflate",
        Inflate: "node.zlib.Zlib",
        createInflate: "fn(options: ?) -> +node.zlib.Inflate",
        InflateRaw: "node.zlib.Zlib",
        createInflateRaw: "fn(options: ?) -> +node.zlib.InflateRaw",
        DeflateRaw: "node.zlib.Zlib",
        createDeflateRaw: "fn(options: ?) -> +node.zlib.DeflateRaw",
        Unzip: "node.zlib.Zlib",
        createUnzip: "fn(options: ?) -> +node.zlib.Unzip",
        Z_NO_FLUSH: "number",
        Z_PARTIAL_FLUSH: "number",
        Z_SYNC_FLUSH: "number",
        Z_FULL_FLUSH: "number",
        Z_FINISH: "number",
        Z_BLOCK: "number",
        Z_TREES: "number",
        Z_OK: "number",
        Z_STREAM_END: "number",
        Z_NEED_DICT: "number",
        Z_ERRNO: "number",
        Z_STREAM_ERROR: "number",
        Z_DATA_ERROR: "number",
        Z_MEM_ERROR: "number",
        Z_BUF_ERROR: "number",
        Z_VERSION_ERROR: "number",
        Z_NO_COMPRESSION: "number",
        Z_BEST_SPEED: "number",
        Z_BEST_COMPRESSION: "number",
        Z_DEFAULT_COMPRESSION: "number",
        Z_FILTERED: "number",
        Z_HUFFMAN_ONLY: "number",
        Z_RLE: "number",
        Z_FIXED: "number",
        Z_DEFAULT_STRATEGY: "number",
        Z_BINARY: "number",
        Z_TEXT: "number",
        Z_ASCII: "number",
        Z_UNKNOWN: "number",
        Z_DEFLATED: "number",
        Z_NULL: "number"
      },
      os: {
        tmpDir: "fn() -> string",
        hostname: "fn() -> string",
        type: "fn() -> string",
        platform: "fn() -> string",
        arch: "fn() -> string",
        release: "fn() -> string",
        uptime: "fn() -> number",
        loadavg: "fn() -> [number]",
        totalmem: "fn() -> number",
        freemem: "fn() -> number",
        cpus: "fn() -> [os.cpuSpec]",
        networkInterfaces: "fn() -> ?",
        EOL: "string"
      },
      punycode: {
        decode: "fn(string: string) -> string",
        encode: "fn(string: string) -> string",
        toUnicode: "fn(domain: string) -> string",
        toASCII: "fn(domain: string) -> string",
        ucs2: {
          decode: "fn(string: string) -> string",
          encode: "fn(codePoints: [number]) -> string"
        },
        version: "?"
      },
      repl: {
        start: "fn(options: ?) -> +EventEmitter"
      },
      readline: {
        createInterface: "fn(options: ?) -> +node.readline.Interface",
        Interface: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            setPrompt: "fn(prompt: string, length: number)",
            prompt: "fn(preserveCursor?: bool)",
            question: "fn(query: string, callback: fn())",
            pause: "fn()",
            resume: "fn()",
            close: "fn()",
            write: "fn(data: ?, key?: ?)"
          }
        }
      },
      vm: {
        createContext: "fn(initSandbox?: ?) -> ?",
        Script: {
          "!type": "fn()",
          prototype: {
            runInThisContext: "fn()",
            runInNewContext: "fn(sandbox?: ?)"
          }
        },
        runInThisContext: "fn(code: string, filename?: string)",
        runInNewContext: "fn(code: string, sandbox?: ?, filename?: string)",
        runInContext: "fn(code: string, context: ?, filename?: string)",
        createScript: "fn(code: string, filename?: string) -> +node.vm.Script"
      },
      child_process: {
        ChildProcess: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            stdin: "+node.stream.Writable",
            stdout: "+node.stream.Readable",
            stderr: "+node.stream.Readable",
            pid: "number",
            kill: "fn(signal?: string)",
            send: "fn(message: ?, sendHandle?: ?)",
            disconnect: "fn()"
          }
        },
        spawn: "fn(command: string, args?: [string], options?: ?) -> +node.child_process.ChildProcess",
        exec: "fn(command: string, callback: fn(error: ?, stdout: +Buffer, stderr: +Buffer)) -> +node.child_process.ChildProcess",
        execFile: "fn(file: string, args: [string], options: ?, callback: fn(error: ?, stdout: +Buffer, stderr: +Buffer)) -> +node.child_process.ChildProcess",
        fork: "fn(modulePath: string, args?: [string], options?: ?) -> +node.child_process.ChildProcess"
      },
      url: {
        parse: "fn(urlStr: string, parseQueryString?: bool, slashesDenoteHost?: bool) -> url.type",
        format: "fn(url: url.type) -> string",
        resolve: "fn(from: string, to: string) -> string"
      },
      dns: {
        lookup: "fn(domain: string, callback: fn(err: +Error, address: string, family: number)) -> string",
        resolve: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolve4: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolve6: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolveMx: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolveTxt: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolveSrv: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolveNs: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        resolveCname: "fn(domain: string, callback: fn(err: +Error, addresses: [string])) -> [string]",
        reverse: "fn(ip: string, callback: fn(err: +Error, domains: [string])) -> [string]"
      },
      net: {
        createServer: "fn(options?: ?, connectionListener?: fn(socket: +node.net.Socket)) -> +node.net.Server",
        Server: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.net.Socket.prototype",
            listen: "fn(port: number, hostname?: string, backlog?: number, callback?: fn())",
            close: "fn(callback?: fn())",
            maxConnections: "number",
            getConnections: "fn(callback: fn(err: +Error, count: number))"
          }
        },
        Socket: {
          "!type": "fn(options: ?)",
          prototype: {
            "!proto": "EventEmitter.prototype",
            connect: "fn(port: number, host?: string, connectionListener?: fn())",
            bufferSize: "number",
            setEncoding: "fn(encoding?: string)",
            write: "fn(data: +Buffer, encoding?: string, callback?: fn())",
            end: "fn(data?: +Buffer, encoding?: string)",
            destroy: "fn()",
            pause: "fn()",
            resume: "fn()",
            setTimeout: "fn(timeout: number, callback?: fn())",
            setKeepAlive: "fn(enable?: bool, initialDelay?: number)",
            address: "fn() -> net.address",
            unref: "fn()",
            ref: "fn()",
            remoteAddress: "string",
            remotePort: "number",
            localPort: "number",
            bytesRead: "number",
            bytesWritten: "number"
          }
        },
        connect: "fn(options: ?, connectionListener?: fn()) -> +node.net.Socket",
        createConnection: "fn(options: ?, connectionListener?: fn()) -> +node.net.Socket",
        isIP: "fn(input: string) -> number",
        isIPv4: "fn(input: string) -> bool",
        isIPv6: "fn(input: string) -> bool"
      },
      dgram: {
        createSocket: "fn(type: string, callback?: fn()) -> +node.dgram.Socket",
        Socket: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            send: "fn(buf: +Buffer, offset: number, length: number, port: number, address: string, callback?: fn())",
            bind: "fn(port: number, address?: string)",
            close: "fn()",
            address: {
              address: "string",
              family: "string",
              port: "number"
            },
            setBroadcast: "fn(flag: bool)",
            setMulticastTTL: "fn(ttl: number)",
            setMulticastLoopback: "fn(flag: bool)",
            addMembership: "fn(multicastAddress: string, multicastInterface?: string)",
            dropMembership: "fn(multicastAddress: string, multicastInterface?: string)"
          }
        }
      },
      fs: {
        rename: "fn(oldPath: string, newPath: string, callback?: fn())",
        renameSync: "fn(oldPath: string, newPath: string)",
        ftruncate: "fn(fd: number, len: number, callback?: fn())",
        ftruncateSync: "fn(fd: number, len: number)",
        truncate: "fn(path: string, len: number, callback?: fn())",
        truncateSync: "fn(path: string, len: number)",
        chown: "fn(path: string, uid: number, gid: number, callback?: fn())",
        chownSync: "fn(path: string, uid: number, gid: number)",
        fchown: "fn(fd: number, uid: number, gid: number, callback?: fn())",
        fchownSync: "fn(fd: number, uid: number, gid: number)",
        lchown: "fn(path: string, uid: number, gid: number, callback?: fn())",
        lchownSync: "fn(path: string, uid: number, gid: number)",
        chmod: "fn(path: string, mode: string, callback?: fn())",
        chmodSync: "fn(path: string, mode: string)",
        fchmod: "fn(fd: number, mode: string, callback?: fn())",
        fchmodSync: "fn(fd: number, mode: string)",
        lchmod: "fn(path: string, mode: number, callback?: fn())",
        lchmodSync: "fn(path: string, mode: string)",
        stat: "fn(path: string, callback?: fn(err: +Error, stats: +node.fs.Stats) -> ?) -> +node.fs.Stats",
        lstat: "fn(path: string, callback?: fn(err: +Error, stats: +node.fs.Stats) -> ?) -> +node.fs.Stats",
        fstat: "fn(fd: number, callback?: fn(err: +Error, stats: +node.fs.Stats) -> ?) -> +node.fs.Stats",
        statSync: "fn(path: string) -> +node.fs.Stats",
        lstatSync: "fn(path: string) -> +node.fs.Stats",
        fstatSync: "fn(fd: number) -> +node.fs.Stats",
        link: "fn(srcpath: string, dstpath: string, callback?: fn())",
        linkSync: "fn(srcpath: string, dstpath: string)",
        symlink: "fn(srcpath: string, dstpath: string, type?: string, callback?: fn())",
        symlinkSync: "fn(srcpath: string, dstpath: string, type?: string)",
        readlink: "fn(path: string, callback?: fn(err: +Error, linkString: string))",
        readlinkSync: "fn(path: string)",
        realpath: "fn(path: string, cache: string, callback: fn(err: +Error, resolvedPath: string))",
        realpathSync: "fn(path: string, cache?: bool) -> string",
        unlink: "fn(path: string, callback?: fn())",
        unlinkSync: "fn(path: string)",
        rmdir: "fn(path: string, callback?: fn())",
        rmdirSync: "fn(path: string)",
        mkdir: "fn(path: string, mode?: ?, callback?: fn())",
        mkdirSync: "fn(path: string, mode?: string)",
        readdir: "fn(path: string, callback?: fn(err: +Error, files: [string]))",
        readdirSync: "fn(path: string) -> [string]",
        close: "fn(fd: number, callback?: fn())",
        closeSync: "fn(fd: number)",
        open: "fn(path: string, flags: string, mode?: string, callback?: fn(err: +Error, fd: number))",
        openSync: "fn(path: string, flags: string, mode?: string) -> number",
        utimes: "fn(path: string, atime: number, mtime: number, callback?: fn())",
        utimesSync: "fn(path: string, atime: number, mtime: number)",
        futimes: "fn(fd: number, atime: number, mtime: number, callback?: fn())",
        futimesSync: "fn(fd: number, atime: number, mtime: number)",
        fsync: "fn(fd: number, callback?: fn())",
        fsyncSync: "fn(fd: number)",
        write: "fn(fd: number, buffer: +Buffer, offset: number, length: number, position: number, callback?: fn(err: +Error, written: number, buffer: +Buffer))",
        writeSync: "fn(fd: number, buffer: +Buffer, offset: number, length: number, position: number) -> number",
        read: "fn(fd: number, buffer: +Buffer, offset: number, length: number, position: number, callback?: fn(err: +Error, bytesRead: number, buffer: +Buffer))",
        readSync: "fn(fd: number, buffer: +Buffer, offset: number, length: number, position: number) -> number",
        readFile: "fn(filename: string, callback: fn(err: +Error, data: +Buffer))",
        readFileSync: "fn(filename: string, encoding: string) -> +Buffer",
        writeFile: "fn(filename: string, data: +Buffer, encoding?: string, callback?: fn())",
        writeFileSync: "fn(filename: string, data: +Buffer, encoding?: string)",
        appendFile: "fn(filename: string, data: ?, encoding?: string, callback?: fn())",
        appendFileSync: "fn(filename: string, data: ?, encoding?: string)",
        watchFile: "fn(filename: string, options: ?, listener: fn(current: +node.fs.Stats, prev: +node.fs.Stats))",
        unwatchFile: "fn(filename: string, listener?: fn())",
        watch: "fn(filename: string, options?: ?, listener?: fn(event: string, filename: string)) -> +node.fs.FSWatcher",
        exists: "fn(path: string, callback?: fn(exists: bool))",
        existsSync: "fn(path: string) -> bool",
        Stats: {
          "!type": "fn()",
          prototype: {
            isFile: "fn() -> bool",
            isDirectory: "fn() -> bool",
            isBlockDevice: "fn() -> bool",
            isCharacterDevice: "fn() -> bool",
            isSymbolicLink: "fn() -> bool",
            isFIFO: "fn() -> bool",
            isSocket: "fn() -> bool",
            dev: "number",
            ino: "number",
            mode: "number",
            nlink: "number",
            uid: "number",
            gid: "number",
            rdev: "number",
            size: "number",
            blksize: "number",
            blocks: "number",
            atime: "Date",
            mtime: "Date",
            ctime: "Date"
          }
        },
        createReadStream: "fn(path: string, options?: ?) -> +node.stream.Readable",
        createWriteStream: "fn(path: string, options?: ?) -> +node.stream.Writable",
        FSWatcher: {
          "!type": "fn()",
          prototype: {
            close: "fn()"
          }
        }
      },
      path: {
        normalize: "fn(p: string) -> string",
        join: "fn() -> string",
        resolve: "fn(from: string, from2: string, from3: string, from4: string, from5: string, to: string) -> string",
        relative: "fn(from: string, to: string) -> string",
        dirname: "fn(p: string) -> string",
        basename: "fn(p: string, ext?: string) -> string",
        extname: "fn(p: string) -> string",
        sep: "string"
      },
      string_decoder: {
        StringDecoder: {
          "!type": "fn(encoding?: string)",
          prototype: {
            write: "fn(buffer: +Buffer) -> string",
            end: "fn()"
          }
        }
      },
      tls: {
        CLIENT_RENEG_LIMIT: "number",
        CLIENT_RENEG_WINDOW: "number",
        SLAB_BUFFER_SIZE: "number",
        Server: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.net.Server.prototype",
            listen: "fn(port: number, host?: string, callback?: fn())",
            close: "fn()",
            addContext: "fn(hostName: string, credentials: tls.Server.credentials)"
          }
        },
        createServer: "fn(options?: ?, connectionListener?: fn(stream: +node.tls.ClearTextStream)) -> +node.tls.Server",
        ClearTextStream: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Duplex.prototype",
            authorized: "bool",
            authorizationError: "+Error",
            getPeerCertificate: "fn() -> ?",
            getCipher: "fn() -> tls.cipher",
            address: "net.address",
            remoteAddress: "string",
            remotePort: "number"
          }
        },
        connect: "fn(port: number, host?: string, options: ?, listener: fn()) -> +node.tls.ClearTextStream",
        createSecurePair: "fn(credentials?: crypto.credentials, isServer?: bool, requestCert?: bool, rejectUnauthorized?: bool) -> +node.tls.SecurePair",
        SecurePair: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            cleartext: "+node.tls.ClearTextStream",
            encrypted: "+node.stream.Duplex"
          }
        }
      },
      crypto: {
        getCyphers: "fn() -> [string]",
        getHashes: "fn() -> [string]",
        createCredentials: "fn(details?: ?) -> crypto.credentials",
        createHash: "fn(algorithm: string) -> +node.crypto.Hash",
        Hash: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Duplex.prototype",
            update: "fn(data: +Buffer, encoding?: string)",
            digest: "fn(encoding?: string) -> +Buffer"
          }
        },
        createHmac: "fn(algorithm: string, key: string) -> +node.crypto.Hmac",
        Hmac: {
          "!type": "fn()",
          prototype: {
            update: "fn(data: +Buffer)",
            digest: "fn(encoding?: string) -> +Buffer"
          }
        },
        createCipher: "fn(algorithm: string, password: string) -> +node.crypto.Cipher",
        createCipheriv: "fn(algorithm: string, password: string, iv: string) -> +node.crypto.Cipher",
        Cipher: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Duplex.prototype",
            update: "fn(data: +Buffer, input_encoding?: string, output_encoding?: string) -> +Buffer",
            final: "fn(output_encoding?: string) -> +Buffer",
            setAutoPadding: "fn(auto_padding: bool)"
          }
        },
        createDecipher: "fn(algorithm: string, password: string) -> +node.crypto.Decipher",
        createDecipheriv: "fn(algorithm: string, key: string, iv: string) -> +node.crypto.Decipher",
        Decipher: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Duplex.prototype",
            update: "fn(data: +Buffer, input_encoding?: string, output_encoding?: string)",
            final: "fn(output_encoding?: string) -> +Buffer",
            setAutoPadding: "fn(auto_padding: bool)"
          }
        },
        createSign: "fn(algorithm: string) -> +node.crypto.Signer",
        Signer: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Writable.prototype",
            update: "fn(data: +Buffer)",
            sign: "fn(private_key: string, output_format: string) -> +Buffer"
          }
        },
        createVerify: "fn(algorith: string) -> +node.crypto.Verify",
        Verify: {
          "!type": "fn()",
          prototype: {
            "!proto": "node.stream.Writable.prototype",
            update: "fn(data: +Buffer)",
            verify: "fn(object: string, signature: string, signature_format?: string) -> bool"
          }
        },
        createDiffieHellman: "fn(prime: number, encoding?: string) -> +node.crypto.DiffieHellman",
        DiffieHellman: {
          "!type": "fn()",
          prototype: {
            generateKeys: "fn(encoding?: string) -> +Buffer",
            computeSecret: "fn(other_public_key: +Buffer, input_encoding?: string, output_encoding?: string) -> +Buffer",
            getPrime: "fn(encoding?: string) -> +Buffer",
            getGenerator: "fn(encoding: string) -> +Buffer",
            getPublicKey: "fn(encoding?: string) -> +Buffer",
            getPrivateKey: "fn(encoding?: string) -> +Buffer",
            setPublicKey: "fn(public_key: +Buffer, encoding?: string)",
            setPrivateKey: "fn(public_key: +Buffer, encoding?: string)"
          }
        },
        getDiffieHellman: "fn(group_name: string) -> +node.crypto.DiffieHellman",
        pbkdf2: "fn(password: string, salt: string, iterations: number, keylen: number, callback: fn(err: +Error, derivedKey: string))",
        randomBytes: "fn(size: number, callback?: fn(err: +Error, buf: +Buffer))",
        pseudoRandomBytes: "fn(size: number, callback?: fn(err: +Error, buf: +Buffer))",
        DEFAULT_ENCODING: "string"
      },
      util: {
        format: "fn(format: string) -> string",
        debug: "fn(msg: string)",
        error: "fn(msg: string)",
        puts: "fn(data: string)",
        print: "fn(data: string)",
        log: "fn(string: string)",
        inspect: "fn(object: ?, options: ?) -> string",
        isArray: "fn(object: ?) -> bool",
        isRegExp: "fn(object: ?) -> bool",
        isDate: "fn(object: ?) -> bool",
        isError: "fn(object: ?) -> bool",
        inherits: "fn(constructor: ?, superConstructor: ?)"
      },
      assert: {
        "!type": "fn(value: ?, message?: string)",
        fail: "fn(actual: ?, expected: ?, message: string, operator: string)",
        ok: "fn(value: ?, message?: string)",
        equal: "fn(actual: ?, expected: ?, message?: string)",
        notEqual: "fn(actual: ?, expected: ?, message?: string)",
        deepEqual: "fn(actual: ?, expected: ?, message?: string)",
        notDeepEqual: "fn(acutal: ?, expected: ?, message?: string)",
        strictEqual: "fn(actual: ?, expected: ?, message?: string)",
        notStrictEqual: "fn(actual: ?, expected: ?, message?: string)",
        throws: "fn(block: fn(), error?: ?, messsage?: string)",
        doesNotThrow: "fn(block: fn(), error?: ?, messsage?: string)",
        ifError: "fn(value: ?)"
      },
      tty: {
        isatty: "fn(fd: number) -> bool"
      },
      domain: {
        create: "fn() -> +EventEmitter",
        Domain: {
          "!type": "fn()",
          prototype: {
            "!proto": "EventEmitter.prototype",
            run: "fn(fn: fn())",
            member: "[+EventEmitter]",
            add: "fn(emitter: +EventEmitter)",
            remove: "fn(emitter: +EventEmitter)",
            bind: "fn(callback: fn(err: +Error, data: ?)) -> $0",
            intercept: "fn(cb: fn(data: ?)) -> $0",
            dispose: "fn()"
          }
        }
      }
    }
  };
});
