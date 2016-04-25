/* @flow */

import {format} from 'util';

export type FlowResult = {
  passed: boolean,
  errors: Array<FlowError>,
  flowVersion: string,
};
type FlowError = {
  kind: string,
  level: string,
  message: Array<FlowMessage>,
  trace: ?Array<FlowMessage>,
  operation?: FlowMessage,
  extra?: FlowExtra,
};
type FlowMessage = {
  descr: string,
  type: "Blame" | "Comment",
  context?: ?string,
  loc?: ?FlowLoc,
  indent?: number,
};
type FlowExtra = Array<{
  message: Array<FlowMessage>,
  children: FlowExtra,
}>
type FlowLoc = {
  source: ?string,
  type: ?("LibFile" | "SourceFile" | "JsonFile" | "Builtin"),
  start: FlowPos,
  end: FlowPos,
}
type FlowPos = {
  line: number,
  column: number,
  offset: number,
}

export const noErrors: FlowResult = {
  passed: true,
  errors: [],
  flowVersion: "No version",
};

// Returns a result that is a - b
export function difference(a: FlowResult, b: FlowResult): FlowResult {
  const oldHashes = {};
  const errors = [];
  for (let error of b.errors) {
    const hash = JSON.stringify(error.message);
    oldHashes[hash] = error;
  }
  for (let error of a.errors) {
    const hash = JSON.stringify(error.message);
    if (oldHashes[hash] !== undefined) {
      continue;
    }
    errors.push(JSON.parse(JSON.stringify(error)));
  }
  return {
    passed: errors.length === 0,
    errors,
    flowVersion: a.flowVersion,
  };
}

export function prettyPrintWithHeader(result: FlowResult): string {
  if (result.passed) {
    return "No errors";
  }

  return format(
    "%d error%s\n%s",
    result.errors.length,
    result.errors.length === 1 ? "" : "s",
    prettyPrint(result),
  );
}

export function prettyPrint(result: FlowResult): string {
  // Copy the result so we can mess with it
  result = JSON.parse(JSON.stringify(result));
  return result.errors.map(prettyPrintError).join("\n\n");
}

function prettyPrintError(error: FlowError): string {
  const { level, kind, message, operation, trace, extra } = error;
  let mainLoc = operation && operation.loc || message[0].loc;
  let messages = [].concat(
    getHeader(mainLoc),
    getKindMessage(kind, level, message),
    getOpReason(operation),
    message,
    getExtraMessages(extra),
    getTraceReasons(trace),
  );
  const mainFile = mainLoc && mainLoc.source || "[No file]";
  // Merge comments into blames
  messages = messages.reduce((acc, message) => {
    const {descr, loc, type} = message;
    if (loc != null || acc.length == 0 || type == "Blame") {
      acc.push(message);
    } else if (descr != "Error:") {
      const prev = acc[acc.length - 1];
      prev.descr = prev.descr == "" ? descr : format("%s. %s", prev.descr, descr);
    }
    return acc;
  }, []);
  return messages.map(prettyPrintMessage.bind(null, mainFile)).join("\n");
}

function mkComment(descr: string): FlowMessage {
  return { descr, type: "Comment" };
}

function getHeader(mainLoc: ?FlowLoc): Array<FlowMessage> {
  let line = -1;
  let filename = "[No file]";
  if (mainLoc != null) {
    const {source, start} = mainLoc;
    line = start.line;
    if (source != null) {
      filename = source;
    }
  }
  return [mkComment(format("%s:%d", filename, line))];
}

function getKindMessage(
  kind: string,
  level: string,
  message: Array<FlowMessage>,
): Array<FlowMessage> {
  const internal_error_prefix = "Internal error (see logs): ";
  if (message.length > 0) {
    let {context, loc} = message[0];
    let descr = null;
    if (kind == "internal" && level == "error") {
      descr = internal_error_prefix;
    } else if (loc != null && loc.type == "LibFile") {
      if (kind == "parse" && level == "error") {
        descr = "Library parse error:";
      } else if (kind == "infer") {
        descr = "Library type error:"
      }
    }

    if (descr != null) {
      return [{ context, loc, descr, type: "Blame" }];
    }
  }
  return [];
}

function getOpReason(op: ?FlowMessage): Array<FlowMessage> {
  if (op) {
    return [
      op,
      mkComment("Error:"),
    ];
  }
  return [];
}

function getExtraMessages(extra: ?FlowExtra): Array<FlowMessage> {
  if (extra) {
    const messages = extra.reduce((acc, current) => {
      const childrenMessages = current.children == null ?
        [] :
        getExtraMessages(current.children);
      const messages = acc.concat(current.message, childrenMessages);
      return messages;
    }, []);
    messages.forEach(message => message.indent = (message.indent || 0)+2);
    return messages;
  }
  return [];
}

function getTraceReasons(trace: ?Array<FlowMessage>): Array<FlowMessage> {
  if (trace != null && trace.length > 0) {
    return [{ descr: "Trace:", type: "Blame" }].concat(trace);
  }
  return [];
}

function prettyPrintMessage(
  mainFile: string,
  {context, descr, loc, indent}: FlowMessage,
): string {
  const indentation = Array((indent || 0)+1).join(" ");
  if (loc != null) {
    let startCol = loc.start.column - 1;
    let contextStr = indentation;
    if (context != null) {
      let lineStr = String(loc.start.line);
      if (lineStr.length < 3) {
        lineStr = ("   "+lineStr).slice(-3);
      }
      lineStr += ": ";
      let padding = Array(lineStr.length+1).join(" ");
      if (context.length > startCol) {
        padding += context.substr(0, startCol).replace(/[^\t ]/g, " ");
      }
      const underline_size = loc.start.line == loc.end.line ?
        Math.max(1, loc.end.column - startCol) :
        1;
      const underline = Array(underline_size+1).join("^");
      contextStr = format(
        "%s%s%s\n%s%s%s ",
        indentation,
        lineStr,
        context,
        indentation,
        padding,
        underline,
      );
    }
    let see_another_file = loc.source == mainFile ?
      "" :
      format(". See: %s:%d", loc.source, loc.start.line);
    return format("%s%s%s", contextStr, descr, see_another_file);
  }
  return indentation+descr;
}