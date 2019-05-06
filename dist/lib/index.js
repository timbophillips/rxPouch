"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pouchdb_1 = __importDefault(require("pouchdb"));
const pouchdb_find_1 = __importDefault(require("pouchdb-find"));
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const uuid_1 = require("uuid");
class RxPouch {
    constructor(remoteCouchDB, localCouchDBName, mangoIndex, mangoSelector) {
        this._view$ = (design_view_name) => {
            return rxjs_1.from(this._remoteDB.query(design_view_name, {
                include_docs: true
            })).pipe(
            // just the rows
            operators_1.pluck("rows"), 
            // just the docs
            operators_1.map(x => x
                // just the docs
                .map(z => z["doc"])
                // filter out any views / indices
                .filter(a => a._id.substr(0, 2) !== "_d")
                // add in a field with the attachment URL
                .map(y => this.fixAttachment(y))));
        };
        this._allDocs$ = () => {
            return rxjs_1.from(this._localDB.allDocs({
                include_docs: true,
                attachments: false
            })).pipe(
            // just the rows
            operators_1.pluck("rows"), 
            // just the docs
            operators_1.map(x => x
                // just the docs
                .map(z => z["doc"])
                // filter out any views / indices
                .filter(a => a._id.substr(0, 2) !== "_d")
                // add in a field with the attachment URL
                .map(y => this.fixAttachment(y))));
        };
        // check if local and remote database are online and in sync
        // returns -1 if offline, >0  for sync. (1 = 100%)
        // -2 is some other error returned by PouchDb info
        this._syncCheck$ = () => {
            // if both objects exist then make an Observable from their info() methods
            return rxjs_1.forkJoin(this._localDB.info(), this._remoteDB.info()).pipe(
            // in NodeJS _remoteDB.info will not complete promise if offline
            // treat anything that takes more than a second as offline
            operators_1.timeout(1000), 
            // forkjoin spits out an array of the two results
            operators_1.map(x => {
                const y = x;
                if (y[0].doc_count && y[1].doc_count) {
                    // return the ratio of local : remote doc count
                    return y[0].doc_count / y[1].doc_count;
                }
                else {
                    // must be offline
                    return -1;
                }
            }), 
            // some other error also means offline
            operators_1.catchError((error, caught) => rxjs_1.of(-2)));
        };
        this.rxView = (design_view_name) => {
            return this._view$(design_view_name);
        };
        this.putDoc = (doc) => {
            // add a random uuid as the _id if none supplied
            if (!doc._id) {
                doc._id = uuid_1.v4();
            }
            return rxjs_1.from(this._localDB.put(
            // this bit to guard against funny
            // stuff being supplied that isnt
            // JSON compliant
            JSON.parse(JSON.stringify(doc))));
        };
        // straight conversion and re-issue of the PouchDB promise
        this.getDoc = (_id) => rxjs_1.from(this._localDB.get(_id));
        this.deleteDoc = (_id) => {
            // grab the document
            return this.getDoc(_id).pipe(
            // add the _deleted flag to the document
            operators_1.map(docToDelete => Object.assign(docToDelete, { _deleted: true })), 
            // put this flagged document (Pouch/Couch will delete it)
            operators_1.concatMap(docFlagged => this.putDoc(docFlagged)));
        };
        this.findDocs = (mango) => rxjs_1.from(this._localDB.find(mango))
            // just want the docs
            .pipe(operators_1.pluck("docs"));
        this.createIndex = (mango) => rxjs_1.from(this._localDB.createIndex(mango));
        // hook up the pouchdb find plugin (mango queries)
        pouchdb_1.default.plugin(pouchdb_find_1.default);
        // use either the provided address or a default
        this._remoteAddress = remoteCouchDB || "http://localhost:5984/delete_me";
        // JS trickery to get last bit of URL
        // (which is the database name)
        const parts = this._remoteAddress.split("/");
        this._localName =
            localCouchDBName || parts.pop() || parts.pop() || "unnamed"; // handle potential trailing slash
        // start PouchDB instances, one for local one for remote
        this._remoteDB = new pouchdb_1.default(this._remoteAddress);
        this._localDB = new pouchdb_1.default(this._localName);
        // if mango index & selector provided for filtered replication
        if (mangoSelector) {
            this._localDB.createIndex(mangoIndex);
            this._localDB.find({
                selector: mangoSelector
            });
            this._remoteDB.find({
                selector: mangoSelector
            });
        }
        // bilaterl sync arm one (separate in case individualised changes needed)
        this._syncDown = pouchdb_1.default.replicate(this._remoteDB, this._localDB, {
            live: true,
            retry: true,
            selector: mangoSelector
        });
        // bilaterl sync arm two (separate in case individualised changes needed)
        this._syncUp = pouchdb_1.default.replicate(this._localDB, this._remoteDB, {
            live: true,
            retry: true,
            selector: mangoSelector
        });
        // log replication errors
        rxjs_1.fromEvent(this._syncUp, "error")
            .pipe(operators_1.merge(rxjs_1.fromEvent(this._syncDown, "error")), operators_1.delay(5000))
            .subscribe(x => console.log(x));
        // hook up changes event
        this._changes$ = rxjs_1.fromEvent(this._localDB.changes({
            since: "now",
            live: true,
            include_docs: false
        }), "change");
        // hook up paused event
        this._paused$ = rxjs_1.fromEvent(this._syncUp, "paused").pipe(
        // lump all of these together
        operators_1.merge(this._changes$), operators_1.merge(rxjs_1.fromEvent(this._syncUp, "active")), operators_1.merge(rxjs_1.fromEvent(this._syncDown, "paused")), operators_1.merge(rxjs_1.fromEvent(this._syncDown, "active")), 
        // on NodeJS the paused event doesnt fire
        // when remoteDB goes offline
        // so check every few secs
        operators_1.merge(rxjs_1.interval(5000)), 
        // this also prevents febrile
        // firing from all of the listeners at once
        operators_1.debounceTime(1000));
    }
    fixAttachment(doc) {
        // this is to use the _attachments field from CouchDB
        // and create a local url which will depend on the
        // couchDB url etc etc and add it as the attachmentUrl
        // (note no underscore or plural) field
        if (doc._attachments) {
            return Object.assign({}, doc, {
                attachmentUrl: this._remoteAddress +
                    "/" +
                    doc._id +
                    "/" +
                    Object.keys(doc._attachments)[0]
            });
        }
        else {
            return doc;
        }
    }
    get rxDocs() {
        return this._changes$.pipe(
        // so that it fires once when subscribed to
        // then fires on _changes$ stream
        operators_1.merge(rxjs_1.of(0)), operators_1.mergeMap(x => this._allDocs$()), operators_1.distinctUntilChanged());
    }
    get rxSync() {
        return this._paused$.pipe(
        // so that it fires once when subscribed to
        // then fires on paused$ stream
        operators_1.merge(rxjs_1.of(0)), operators_1.mergeMap(x => this._syncCheck$()), operators_1.distinctUntilChanged());
    }
    // return a JSON object the current docs
    // and the current sync number and status
    // when either streams updates
    get log() {
        // combineLatest will emit the latest of each
        // whenever either of them updates
        return rxjs_1.combineLatest(this.rxDocs, this.rxSync).pipe(operators_1.mergeMap(x => {
            // human readable text to explain sync number
            let syncText = "remote couchDB ";
            switch (true) {
                case x[1] < 0:
                    syncText += "offline";
                    break;
                case x[1] === 1:
                    syncText += "online and in sync";
                    break;
                case x[1] > 1:
                    syncText += "uploading";
                    break;
                default:
                    syncText += "downloading";
                    break;
            }
            // assemble a nice JSON object that
            // has the docs and then the sync stuff
            return rxjs_1.of({
                "PouchDB docs array": x[0],
                "sync code": x[1].toString(),
                "sync description": syncText
            });
        }));
    }
}
exports.RxPouch = RxPouch;
