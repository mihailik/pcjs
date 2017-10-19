---
layout: page
title: "Q32858: LOCAL Directive Requires Language Parameter"
permalink: /pubs/pc/reference/microsoft/kb/Q32858/
---

## Q32858: LOCAL Directive Requires Language Parameter

	Article: Q32858
	Version(s): 5.10   | 5.10
	Operating System: MS-DOS | OS/2
	Flags: ENDUSER | buglist5.10
	Last Modified: 15-JUL-1988
	
	The LOCAL directive used inside a procedure requires a language
	parameter in the .MODEL directive. The warning A4001: "Extra characters
	on line" will be incorrectly generated by the assembler.
	   The following is an example:
	
	    .model small
	    .code
	    proc1 proc
	    local x:dword
	    proc1 endp
	    end
	
	   The statement "local x:dword" will generate the warning.
	   The workaround for this problem is to specify a language parameter.
	To correct the program above, replace the statement ".model small"
	with ".model small,fortran".
	   Microsoft has confirmed this to be a problem in Version 5.10. We
	are researching this problem and will post new information as it
	becomes available.