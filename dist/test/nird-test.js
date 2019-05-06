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
const dist_1 = require("../dist");
const detect_node_1 = __importDefault(require("detect-node"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
let localName = 'temp-pouch2';
let remoteName = 'http://localhost:5984/nird-test';
let localPathName = detect_node_1.default ? path.join(os.tmpdir(), localName) : localName;
console.log(localPathName);
// instantiate the class
let z = new dist_1.RxPouch(remoteName, localPathName);
