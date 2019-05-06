"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const beautifuljson_1 = require("beautifuljson");
const dist_1 = require("../dist");
const detect_node_1 = __importDefault(require("detect-node"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
let localName = 'temp-pouch';
let remoteName = 'http://localhost:5984/tasks3';
let localPathName = detect_node_1.default ? path.join(os.tmpdir(), localName) : localName;
console.log(localPathName);
// instantiate the class
let z = new dist_1.RxPouch(remoteName, localPathName);
// output the log
z.log.subscribe(x => {
    console.clear();
    console.log(beautifuljson_1.beautifulJSON(x));
});
