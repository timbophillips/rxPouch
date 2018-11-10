import PouchDB from 'pouchdb';
import { beautifulJSON } from "./beautifulJSON";
import { Observable, BehaviorSubject, fromEvent, from, forkJoin, of } from 'rxjs';
import { map, catchError, pluck } from 'rxjs/operators';


const local = new PouchDB('tasks');
const remote = new PouchDB('http://localhost:5984/tasks');

PouchDB.sync(local, remote, {
    live: true,
    retry: true
});

local.changes({
    since: 'now',
    live: true,
    include_docs: false
}).on('change', logAllDocs);

logAllDocs(null);

function logAllDocs(x: any) {
    local.allDocs({
        include_docs: true,
        attachments: true
    }).then(x => {
        console.log(beautifulJSON(x));
    });
}


