#!/bin/bash -e

NOCOLOR='\033[0m'
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
ORANGE='\033[0;33m'
YELLOW='\033[1;33m'

FILE=/etc/mosquitto-default-credentials/pw.txt
FILE_CLEAR=/etc/mosquitto-default-credentials/pw_clear.txt
if [ -s $FILE ]
then
	echo "Password for default Mosquitto exists"
else
	echo "Password for default Mosquitto does not exist, will create one."
	touch $FILE
	PASSWORD=$(openssl rand -base64 32)
	mosquitto_passwd -b $FILE cedalo $PASSWORD
	echo $PASSWORD >> $FILE_CLEAR
	echo -e "${GREEN}Password for default Mosquitto created successfully.${NOCOLOR}"
	echo -e "Hashed password for Mosquitto broker is located in ${CYAN}$FILE${NOCOLOR}."
	echo -e "Clear text password for Mosquitto broker is located in ${CYAN}$FILE_CLEAR${NOCOLOR}."
	echo -e "${YELLOW}Warning: ${ORANGE}for security reasons please copy the password from $FILE_CLEAR and delete that file afterwards.${NOCOLOR}"
fi
/usr/bin/supervisord -c /etc/supervisord.conf
