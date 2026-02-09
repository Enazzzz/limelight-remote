#!/usr/bin/env python3
"""
Publish remote controller JSON to NetworkTables so WPILib robot code can read it.

Reads JSON lines from a log file (from BRIDGE_CONTROLLER_LOG) or stdin.
Publishes to /RemoteLimelight/axes (double[]) and /RemoteLimelight/buttons (boolean[]).
Robot code can subscribe to these topics and use the values like a joystick.

Requires: pip install pynetworktables  (RobotPy / FRC NT3 client)

Usage:
  # From log file (bridge writes with BRIDGE_CONTROLLER_LOG=controller.log):
  python scripts/controller_to_networktables.py controller.log

  # Team number (robot at roboRIO-TEAM.local or 10.TE.AM.2):
  set TEAM=1234
  python scripts/controller_to_networktables.py controller.log

  # Custom server (e.g. desktop for testing):
  set NT_SERVER=localhost
  python scripts/controller_to_networktables.py controller.log
"""

import json
import os
import sys
import time

try:
	from networktables import NetworkTables
except ImportError:
	print("Install pynetworktables: pip install pynetworktables", file=sys.stderr)
	sys.exit(1)


def main():
	team = os.environ.get("TEAM", os.environ.get("TEAM_NUMBER", ""))
	server = os.environ.get("NT_SERVER", "")
	if server:
		pass
	elif team.isdigit():
		server = f"roboRIO-{team}.local"
	else:
		server = "localhost"

	NetworkTables.initialize(server=server)
	table = NetworkTables.getTable("RemoteLimelight")

	# WPILib-style: axes 0-5 (Xbox order), buttons 1-10 (we store as 0-9 and robot uses 1-based)
	axes = [0.0] * 6
	buttons = [False] * 10

	def publish():
		table.putNumberArray("axes", axes)
		table.putBooleanArray("buttons", buttons)

	publish()

	if len(sys.argv) > 1:
		log_path = sys.argv[1]
		try:
			with open(log_path, "r") as f:
				f.seek(0, 2)
				while True:
					line = f.readline()
					if not line:
						time.sleep(0.02)
						continue
					line = line.strip()
					if not line:
						continue
					try:
						msg = json.loads(line)
						ax = msg.get("axes", [])
						axes = [float(ax[i]) if i < len(ax) else 0.0 for i in range(6)]
						btns = msg.get("buttons", [])
						buttons = [bool(b) if isinstance(b, (bool, int)) else (float(b) > 0.5) for b in btns[:10]]
						if len(buttons) < 10:
							buttons.extend([False] * (10 - len(buttons)))
						publish()
					except (json.JSONDecodeError, TypeError):
						pass
		except FileNotFoundError:
			print(f"Log file not found: {log_path}. Run bridge with BRIDGE_CONTROLLER_LOG={log_path}", file=sys.stderr)
			sys.exit(1)
		except KeyboardInterrupt:
			pass
	else:
		for line in sys.stdin:
			line = line.strip()
			if line.startswith("[controller]"):
				line = line.replace("[controller]", "", 1).strip()
			if not line:
				continue
			try:
				msg = json.loads(line)
				ax = msg.get("axes", [])
				axes = [float(ax[i]) if i < len(ax) else 0.0 for i in range(6)]
				btns = msg.get("buttons", [])
				buttons = [bool(b) if isinstance(b, (bool, int)) else (float(b) > 0.5) for b in btns[:10]]
				if len(buttons) < 10:
					buttons.extend([False] * (10 - len(buttons)))
				publish()
			except (json.JSONDecodeError, TypeError):
				pass


if __name__ == "__main__":
	main()
