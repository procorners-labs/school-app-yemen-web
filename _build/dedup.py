# -*- coding: utf-8 -*-
# يحذف تعريفات الدوال المكرّرة الميتة (يحتفظ بالأخيرة) بموازنة أقواس آمنة.
import re, sys

BACKSLASH = chr(92)

def scan_end(s, brace_open):
    depth = 0; i = brace_open; n = len(s)
    instr = None; line_c = False; block_c = False
    while i < n:
        c = s[i]; c2 = s[i+1] if i+1 < n else ''
        if line_c:
            if c == '\n': line_c = False
            i += 1; continue
        if block_c:
            if c == '*' and c2 == '/': block_c = False; i += 2; continue
            i += 1; continue
        if instr:
            if c == BACKSLASH: i += 2; continue
            if c == instr: instr = None
            i += 1; continue
        if c == '/' and c2 == '/': line_c = True; i += 2; continue
        if c == '/' and c2 == '*': block_c = True; i += 2; continue
        if c == '"' or c == "'" or c == '`': instr = c; i += 1; continue
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return i
        i += 1
    return -1

def remove_funcs(s, name, keep):
    spans = []
    for m in re.finditer(r'(?:\A|\n)[ \t]*function ' + re.escape(name) + r'\s*\(', s):
        fstart = m.start() + (0 if s[m.start()] == 'f' else 1)
        bo = s.find('{', m.end() - 1)
        if bo == -1: continue
        be = scan_end(s, bo)
        if be == -1: continue
        spans.append((fstart, be + 1))
    if keep == 'last':
        if len(spans) < 2: return s, 0
        targets = sorted(spans)[:-1]
    else:
        targets = spans
    removed = 0
    for (a, b) in sorted(targets, reverse=True):
        end = b
        while end < len(s) and s[end] == '\n': end += 1
        s = s[:a] + s[end:]
        removed += 1
    return s, removed

# TeacherCore: المكرّرات (احتفظ بالأخيرة)
p = 'teacher/TeacherCore.js'
s = open(p, encoding='utf-8').read()
out = []
for fn in ['_getNextHomeworkId', '_addHomeworkInternal', 'getHomeworkProtected',
           'getNewsByIdProtected', 'getStudentAttendanceRecord', 'getTeacherNotesProtected']:
    s, r = remove_funcs(s, fn, 'last'); out.append(fn + '=' + str(r))
open(p + '.tmp', 'w', encoding='utf-8').write(s)

# StudentLogic: getGrades_OLD (ميتة)
p2 = 'student/StudentLogic.js'
s2 = open(p2, encoding='utf-8').read()
s2, r2 = remove_funcs(s2, 'getGrades_OLD', 'none'); out.append('getGrades_OLD=' + str(r2))
open(p2 + '.tmp', 'w', encoding='utf-8').write(s2)

sys.stdout.buffer.write((' | '.join(out)).encode('utf-8'))
