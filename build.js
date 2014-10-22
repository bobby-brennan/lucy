var Repository = require('git-cli').Repository;
var FS = require('fs');
var EJS = require('ejs');
var GLOB = require('glob');
var PATH = require('path');
var EXEC = require('child_process').exec;
var AUTH = require('./auth.js');
var SERVER = require('./server.js');

var ignoreFile = function(file) {
  return file.match(/\.tgz$/) || file.match('/$') || file.match('.*README.md');
}

var FILES_TO_PROCESS = [];
var FILES_PROCESSED = [];
var SRC_DIR = '/tmp/lucytmp';
var DEP_SRC_DIR = '/dep';
var DEST_DIR = process.cwd();

var getPackageDef = function(onDone) {
  FS.readFile(SRC_DIR + '/package.json', function(err, data) {
    var packageDef = {};
    try {
      packageDef = JSON.parse(data);
    } catch (e) {
      console.log('Error parsing package.json');
      throw e;
    }
    onDone(packageDef);
  });
}

var buildCode = function(packageDef, config, onDone) {
  console.log('building code:' + packageDef.lucy_def);
  buildDependencies(packageDef, config, function() {
    console.log('++built deps')
    renderAndCopyFiles(packageDef, config, function() {
      console.log('++copied and rendered');
      runJsScripts(packageDef, config, function() {
        console.log('++ran JS scripts');
        onDone();
      });
    });
  });
}

var buildDependencies = function(packageDef, config, onDone) {
  var deps = packageDef.dependencies;
  if (!deps) {
    return onDone();
  }
  var depKeys = Object.keys(deps);
  if (!depKeys || depKeys.length === 0) {
    return onDone();
  }

  var i = 0;
  SRC_DIR += DEP_SRC_DIR;

  var buildNextDependency = function() {
    if (++i == depKeys.length) {
      SRC_DIR = SRC_DIR.substring(0, SRC_DIR.length - DEP_SRC_DIR.length);
      onDone();
    } else {
      buildDependency(depKeys, deps, i, buildNextDependency);
    }
  };

  buildDependency(depKeys, deps, i, buildNextDependency);
}

var buildDependency = function(depKeys, deps, i, onDone) {
  runForPackage(depKeys[i], deps[depKeys[i]], onDone); 
}

var runJsScripts = function(packageDef, config, onDone) {
  var scripts = packageDef.js_scripts;
  if (!scripts || scripts.length == 0) {
    return onDone();
  }
  var i = -1;
  var runNextScript = function(err) {
    if (err) {throw err}
    if (++i == scripts.length) {
      return onDone();
    }
    var filename = SRC_DIR + '/' + packageDef.js_scripts[i];
    require(filename).run({srcDir: SRC_DIR, destDir: DEST_DIR}, config, runNextScript);
  }
  runNextScript();
}

var renderAndCopyFiles = function(packageDef, config, onDone) {
  console.log('rendering...');
  alterSourcePaths(packageDef.files);
  console.log('new filemap:' + JSON.stringify(packageDef.files));
  FILES_TO_PROCESS = packageDef.files;
  FILES_PROCESSED = [];
  processFilesInQueue(config, onDone);
}

var renderFile = function(map, config, onDone) {
    FS.readFile(map.from, {encoding: 'utf8'}, function(err, data) {
      if (err) {
        console.log('error reading file:' + map.from);
        throw err;
      }
      var rendered = "";
      try {
        rendered = EJS.render(data, config);
      } catch (e) {
        throw "Failed to render!" + e;
      }
      FS.writeFile(map.to, rendered, function(err) {
        if (err) {throw err}
        onDone(map.to);
      });
    });
}

var copyFile = function(map, onDone) {
  FS.readFile(map.from, function(err, data) {
    if (err) {throw err}
    FS.writeFile(map.to, data, function(err) {
      if (err) {throw err}
      onDone(map.to);
    });
  });
}

var processFilesInQueue = function(config, onDone) {
  console.log('proc files:' + JSON.stringify(FILES_TO_PROCESS));
  if (FILES_TO_PROCESS.length == 0) {
    console.log('no files!');
    return onDone();
  }
  for (var i = 0; i < FILES_TO_PROCESS.length; ++i) {
    var onDoneWithFile = function(newFile) {
      FILES_PROCESSED.push(newFile);
      if (FILES_PROCESSED.length === FILES_TO_PROCESS.length) {
        console.log('Created ' + FILES_PROCESSED + ' new files');
        onDone();
      }
    };
    console.log('file:' + JSON.stringify(FILES_TO_PROCESS[i]));
    if (FILES_TO_PROCESS[i].method === 'render') {
      renderFile(FILES_TO_PROCESS[i], config, onDoneWithFile);
    } else {
      copyFile(FILES_TO_PROCESS[i], onDoneWithFile);
    }
  }
}

var alterSourcePaths = function(maps) {
  for (var i = 0; i < maps.length; ++i) {
    maps[i].from = SRC_DIR + '/' + maps[i].from;
  }
}

var TAR_FILENAME = SRC_DIR + '/package.tgz';
var runForPackage = function(packageName, config, onDone) {
  console.log('building:' + packageName);
  maybeLogIn(function(email, password) {
    var maybeHandleErr = function(err) {
      if (err) {
        recursiveRmdir(SRC_DIR);
        throw err;
      }
    }
    FS.mkdir(SRC_DIR, function (err) {
      maybeHandleErr(err);
      var writeStream = FS.createWriteStream(TAR_FILENAME, {encoding: 'binary'});
      SERVER.getPackage(email, password, packageName, writeStream, function(err, data) {
        maybeHandleErr(err);
        var tarCmd = 'tar xzf ' + TAR_FILENAME + ' -C ' + SRC_DIR + '/';
        EXEC(tarCmd, function(err, stdout, stderr) {
          maybeHandleErr(err);
          getPackageDef(function(packageDef) {
            buildCode(packageDef, config, function() {
              recursiveRmdir(SRC_DIR);
              if (onDone) {onDone();}
            });
          });
        });
      });
    });
  });
}

var runForRepo = function(repoLoc, config) {
  Repository.clone(repoLoc, SRC_DIR, function(err, repo) {
    getPackageDef(function(packageDef) {
      buildCode(packageDef, config, function() {
        recursiveRmdir(SRC_DIR);
      });
    });
  });
}

var recursiveRmdir = function(dirName) {
  console.log('rmdir:' + dirName);
  var list = FS.readdirSync(dirName);
  for (var i = 0; i < list.length; i++) {
    var filename = PATH.join(dirName, list[i]);
    var stat = FS.statSync(filename);
    if (filename == "." || filename == "..") {
      // pass these files
    } else if(stat.isDirectory()) {
      // rmdir recursively
      recursiveRmdir(filename);
    } else {
      // rm fiilename
      FS.unlinkSync(filename);
    }
  }
  FS.rmdirSync(dirName);
}

var EMAIL, PASSWORD;

var maybeLogIn = function(onDone) {
  if (!EMAIL || !PASSWORD) {
    AUTH.login(function(email, pass) {
      EMAIL = email;
      PASSWORD = pass;
      onDone(email, pass);
    });
  } else {
    onDone(EMAIL, PASSWORD);
  }
}

exports.run = function(args) {
  var source = args[0];
  var config = args[1];
  if (!source || !config) {
    return true;
  }
  FS.readFile(config, function(err, data) {
    if (err) {
      console.log('error reading from config:' + config);
      throw err;
    }
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.log('error parsing config JSON');
      throw e;
    }
    if (runFromSource(source, data)) {
      console.log('Couldn\'t parse source:' + source);
    }
  });
}

var runFromSource = function(source, config) {
  if (source.lastIndexOf('.git') == source.length - 4) {
    console.log('running from git repo:' + sourceStr);
    runForRepo(source, data);
  } else if (true) {
    var colon = source.indexOf(':');
    if (colon === -1) {
      source += colon + source;
    }
    runForPackage(source, config);
  } else {
    return 1;
  }
}
