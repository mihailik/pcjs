#!/usr/bin/env node
/**
 * @fileoverview Node command-line XML extraction tool
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * Created 2017-Jun-20
 *
 * Copyright © 2012-2018 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of PCjs, a computer emulation software project at <https://www.pcjs.org>.
 *
 * PCjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * PCjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with PCjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every modified copy of this work
 * and to display that copyright notice when the software starts running; see COPYRIGHT in
 * <https://www.pcjs.org/modules/shared/lib/defines.js>.
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of PCjs
 * for purposes of the GNU General Public License, and the author does not claim any copyright
 * as to their contents.
 */

var fs = require("fs");
var defines = require("../../shared/lib/defines");
var Str = require("../../../modules/shared/lib/strlib");
var Proc = require("../../shared/lib/proclib");
var args = Proc.getArgs();

/**
 * printf(format, ...args)
 *
 * @param {string} format
 * @param {...} args
 */
function printf(format, ...args)
{
    process.stdout.write(Str.sprintf(format, ...args));
}

function processManifest(sManifest)
{
    try {
        var sXML = fs.readFileSync(sManifest, 'utf-8');
    } catch(err) {
        printf("error: unable to read manifest: %s\n", sManifest);
        return;
    }
    var aMatchDisks = sXML.match(/<disk[^>]*>[\S\s]*?<\/disk>/g);
    if (!aMatchDisks) {
        printf("warning: no disks found in: %s\n", sManifest);
        return;
    }
    var sDiskTitle;
    var matchTitle = sXML.match(/<title>(.*?)<\/title>/);
    var matchVersion = sXML.match(/<version>(.*?)<\/version>/);
    if (matchTitle && matchVersion) sDiskTitle = matchTitle[1] + ' ' + matchVersion[1];
    for (var iDisk = 0; iDisk < aMatchDisks.length; iDisk++) {
        var sDisk = aMatchDisks[iDisk];
        var matchDir = sDisk.match(/dir="(.*?)"/);
        var matchLink = sDisk.match(/href="(.*?)"/);
        var matchDiskName = sDisk.match(/<name>(.*?)<\/name>/);
        var aMatchFiles = sDisk.match(/<file[^>]*>[\S\s]*?<\/file>/g);
        var sDiskName = matchDiskName && matchDiskName[1] || sDiskTitle;
        if (!aMatchFiles || !sDiskName) {
            printf("warning: no files in disk: %s\n", sDiskName);
            return;
        }
        printf("### Directory of %s\n\n", sDiskName);
        printf("     Volume in drive A %s\n", (matchDiskName? ("is " + matchDiskName[1]) : "has no label"));
        printf("     Directory of  A:\\\n    \n");
        for (var iFile = 0; iFile < aMatchFiles.length; iFile++) {
            var sFile = aMatchFiles[iFile];
            var matchSize = sFile.match(/size="([0-9]*)"/);
            var matchTime = sFile.match(/time="([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9]) ([0-9][0-9]):([0-9][0-9]):([0-9][0-9])"/);
            var matchFileName = sFile.match(/>(.*?)</);
            if (!matchSize || !matchTime || !matchFileName) {
                printf("warning: file entry #%d incomplete\n", iFile);
                return;
            }
            var sSize = matchSize[1];
            var sTime = matchTime[1];
            var sFileName = matchFileName[1].replace(/&amp;/g, "&");
            var sBaseName = sFileName;
            var sExtension = "";
            var i = sFileName.lastIndexOf('.');
            if (i >= 0) {
                sBaseName = sFileName.substr(0, i);
                sExtension = sFileName.substr(i + 1);
            }
            var iMonth = +matchTime[2];
            var iDay = +matchTime[3];
            var iYear = +matchTime[1] % 100;
            var iHour = +matchTime[4];
            var iMinute = +matchTime[5];
            var sSuffix;
            if (iHour < 12) {
                sSuffix = "a";
                if (!iHour) iHour = 12;
            }
            else {
                sSuffix = "p";
                if (iHour > 12) iHour -= 12;
            }
            /*
             * Here's our template, from PC-DOS 2.00:
             *
             *      COMMAND  COM    17664   3-08-83  12:00p
             */
            printf("    %-8s %-3s %8s  %2d-%02d-%02d  %2d:%02d%s\n", sBaseName, sExtension, sSize, iMonth, iDay, iYear, iHour, iMinute, sSuffix);
        }
        printf("\n");
    }
}

if (args.argc > 1) {
    processManifest(args.argv[1]);
    process.exit(0);
}

printf("usage: node disklist.js <manifest>\n");
