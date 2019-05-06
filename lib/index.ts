import PouchDB from "pouchdb";
import PouchFind from "pouchdb-find";
import {
  Observable,
  fromEvent,
  from,
  forkJoin,
  of,
  interval,
  combineLatest,
  throwError
} from "rxjs";
import {
  map,
  pluck,
  merge,
  mergeMap,
  catchError,
  timeout,
  bufferWhen,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  concatMap,
  delay
} from "rxjs/operators";
import { v4 } from "uuid";

export class RxPouch {
  private _remoteAddress: string;
  private _localName: string | undefined;
  private _remoteDB: PouchDB.Database<{}>;
  private _localDB: PouchDB.Database<{}>;
  private _changes$: Observable<any>;
  private _paused$: Observable<any>;
  private _syncUp: PouchDB.Replication.Replication<{}>;
  private _syncDown: PouchDB.Replication.Replication<{}>;

  constructor(
    remoteCouchDB?: string,
    localCouchDBName?: string,
    mangoIndex?: PouchDB.Find.CreateIndexOptions,
    mangoSelector?: PouchDB.Find.Selector
  ) {
    // hook up the pouchdb find plugin (mango queries)
    PouchDB.plugin(PouchFind);

    // use either the provided address or a default
    this._remoteAddress = remoteCouchDB || "http://localhost:5984/delete_me";

    // JS trickery to get last bit of URL
    // (which is the database name)
    const parts = this._remoteAddress.split("/");
    this._localName =
      localCouchDBName || parts.pop() || parts.pop() || "unnamed"; // handle potential trailing slash

    // start PouchDB instances, one for local one for remote
    this._remoteDB = new PouchDB(this._remoteAddress);
    this._localDB = new PouchDB(this._localName);

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
    this._syncDown = PouchDB.replicate(this._remoteDB, this._localDB, {
      live: true,
      retry: true,
      selector: mangoSelector
    });

    // bilaterl sync arm two (separate in case individualised changes needed)
    this._syncUp = PouchDB.replicate(this._localDB, this._remoteDB, {
      live: true,
      retry: true,
      selector: mangoSelector
    });

    // log replication errors
    fromEvent(this._syncUp, "error")
      .pipe(
        merge(fromEvent(this._syncDown, "error")),
        delay(5000)
      )
      .subscribe(x => console.log(x));

    // hook up changes event
    this._changes$ = fromEvent(
      this._localDB.changes({
        since: "now",
        live: true,
        include_docs: false
      }),
      "change"
    );

    // hook up paused event
    this._paused$ = fromEvent(this._syncUp, "paused").pipe(
      // lump all of these together
      merge(this._changes$),
      merge(fromEvent(this._syncUp, "active")),
      merge(fromEvent(this._syncDown, "paused")),
      merge(fromEvent(this._syncDown, "active")),
      // on NodeJS the paused event doesnt fire
      // when remoteDB goes offline
      // so check every few secs
      merge(interval(5000)),
      // this also prevents febrile
      // firing from all of the listeners at once
      debounceTime(1000)
    );
  }

  private _view$ = (design_view_name: string): Observable<any> => {
    return from(
      this._remoteDB.query(design_view_name, {
        include_docs: true
      })
    ).pipe(
      // just the rows
      pluck("rows"),
      // just the docs
      map(x =>
        (x as Array<any>)
          // just the docs
          .map(z => z["doc"])
          // filter out any views / indices
          .filter(a => a._id.substr(0, 2) !== "_d")
          // add in a field with the attachment URL
          .map(y => this.fixAttachment(y))
      )
    );
  };

  private _allDocs$ = (): Observable<any> => {
    return from(
      this._localDB.allDocs({
        include_docs: true,
        attachments: false
      })
    ).pipe(
      // just the rows
      pluck("rows"),
      // just the docs
      map(x =>
        (x as Array<any>)
          // just the docs
          .map(z => z["doc"])
          // filter out any views / indices
          .filter(a => a._id.substr(0, 2) !== "_d")
          // add in a field with the attachment URL
          .map(y => this.fixAttachment(y))
      )
    );
  };

  private fixAttachment(doc: any): any {
    // this is to use the _attachments field from CouchDB
    // and create a local url which will depend on the
    // couchDB url etc etc and add it as the attachmentUrl
    // (note no underscore or plural) field
    if (doc._attachments) {
      return (<any>Object).assign({}, doc, {
        attachmentUrl:
          this._remoteAddress +
          "/" +
          doc._id +
          "/" +
          Object.keys(doc._attachments)[0]
      });
    } else {
      return doc;
    }
  }

  // check if local and remote database are online and in sync
  // returns -1 if offline, >0  for sync. (1 = 100%)
  // -2 is some other error returned by PouchDb info
  private _syncCheck$ = (): Observable<number | {}> => {
    // if both objects exist then make an Observable from their info() methods
    return forkJoin(this._localDB.info(), this._remoteDB.info()).pipe(
      // in NodeJS _remoteDB.info will not complete promise if offline
      // treat anything that takes more than a second as offline
      timeout(1000),
      // forkjoin spits out an array of the two results
      map(x => {
        const y = x as Array<any>;
        if (y[0].doc_count && y[1].doc_count) {
          // return the ratio of local : remote doc count
          return y[0].doc_count / y[1].doc_count;
        } else {
          // must be offline
          return -1;
        }
      }),
      // some other error also means offline
      catchError((error, caught) => of(-2))
    );
  };

  rxView = (design_view_name: string): Observable<any> => {
    return fromEvent(
      this._remoteDB.changes({
        since: "now",
        live: true,
        include_docs: false,
        view: design_view_name, 
        filter: "_view"
      }),
      "change"
    ).pipe(
      merge(of(0)),
      mergeMap(x => this._view$(design_view_name)),
      distinctUntilChanged()
    )    
  };

  get rxDocs(): Observable<any> {
    return this._changes$.pipe(
      // so that it fires once when subscribed to
      // then fires on _changes$ stream
      merge(of(0)),
      mergeMap(x => this._allDocs$()),
      distinctUntilChanged()
    );
  }

  get rxSync(): Observable<number | {}> {
    return this._paused$.pipe(
      // so that it fires once when subscribed to
      // then fires on paused$ stream
      merge(of(0)),
      mergeMap(x => this._syncCheck$()),
      distinctUntilChanged()
    );
  }

  // return a JSON object the current docs
  // and the current sync number and status
  // when either streams updates
  get log(): Observable<{}> {
    // combineLatest will emit the latest of each
    // whenever either of them updates
    return combineLatest(this.rxDocs, this.rxSync).pipe(
      mergeMap(x => {
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
        return of<{}>({
          "PouchDB docs array": x[0],
          "sync code": x[1].toString(),
          "sync description": syncText
        });
      })
    );
  }

  putDoc = (doc: any): Observable<any> => {
    // add a random uuid as the _id if none supplied
    if (!doc._id) {
      doc._id = v4();
    }
    return from(
      this._localDB.put(
        // this bit to guard against funny
        // stuff being supplied that isnt
        // JSON compliant
        JSON.parse(JSON.stringify(doc))
      )
    );
  };

  // straight conversion and re-issue of the PouchDB promise
  getDoc = (_id: string): Observable<any> => from(this._localDB.get(_id));

  deleteDoc = (_id: string): Observable<any> => {
    // grab the document
    return this.getDoc(_id).pipe(
      // add the _deleted flag to the document
      map(docToDelete => (<any>Object).assign(docToDelete, { _deleted: true })),
      // put this flagged document (Pouch/Couch will delete it)
      concatMap(docFlagged => this.putDoc(docFlagged))
    );
  };

  findDocs = (mango: PouchDB.Find.FindRequest<{}>): Observable<any> =>
    from(this._localDB.find(mango))
      // just want the docs
      .pipe(pluck("docs"));

  createIndex = (mango: PouchDB.Find.CreateIndexOptions): Observable<any> =>
    from(this._localDB.createIndex(mango));
}
