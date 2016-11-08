---
layout: page
title: RL11 Disk Controller
permalink: /devices/pdp11/rl11/
---

RL11 Disk Controller
--------------------

The RL11 Disk Controller controls up to four RL01 or RL02 disk drives, which in turn read/write RL01K or
[RL02K](/disks/dec/rl02k/) disk cartridges.

Machines containing the [RL11 Component](/modules/pdp11/lib/pc11.js) include:

- [PDP-11/70 Boot Monitor](/devices/pdp11/machine/1170/monitor/) (with [Debugger](/devices/pdp11/machine/1170/monitor/debugger/))
- [PDP-11/70 with Front Panel](/devices/pdp11/machine/1170/panel/) (with [Debugger](/devices/pdp11/machine/1170/panel/debugger/))

PCjs has archived a selection of [RL02K Disk Images](/disks/dec/rl02k/) for use by those machines, which are
listed in the following RL11 Device XML file:

- [Default](/devices/pdp11/rl11/default.xml)

which is typically referenced by a Machine XML file as:

	<device ref="/devices/pdp11/rl11/default.xml"/>
		
Device XML files not only configure a device, but also list all the resource the device will use, and define UI elements
used to control the device, such as choosing which disks should be "auto-mounted" by the RL11 device.  For example:

	<?xml version="1.0" encoding="UTF-8"?>
	<device id="rl11" type="rl11" autoMount='{RL3:{path:"http://archive.pcjs.org/disks/dec/rl02k/RL02K-XXDP.json"}}' pos="left" width="35%" padLeft="8px" padBottom="8px">
		<name>Disk Drive Controls</name>
		<control type="container">
			<control type="list" binding="listDrives"/>
			<control type="list" binding="listDisks">
				<disk id="rl3" name="XXDP+ Diagnostics" path="http://archive.pcjs.org/disks/dec/rl02k/RL02K-XXDP.json"/>
			</control>
			<control type="button" binding="loadDrive">Load</control>
			<control type="description" binding="descDisk" padRight="8px"/>
			<control type="file" binding="mountDisk"/>
		</control>
	</device>