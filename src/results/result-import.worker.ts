import { parseResultFileRequest } from './worker-handler';
import type { ResultParseRequest } from './worker-handler';
import type { ResultImportResponse } from './importer';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ResultParseRequest>) => void) | null;
  postMessage: (response: ResultImportResponse) => void;
};
workerScope.onmessage = (event) => {
  void parseResultFileRequest(event.data).then((response) => workerScope.postMessage(response));
};
