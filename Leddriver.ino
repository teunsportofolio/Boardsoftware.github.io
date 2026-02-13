#include <WiFi.h>
#include <WebSocketsServer.h>
#include <Adafruit_NeoPixel.h>

#define LED_PIN 5
#define NUM_LEDS 9

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";

WebSocketsServer webSocket = WebSocketsServer(81);

int indexFromRowCol(int row,int col){
  return row*3 + col; // adjust if serpentine wiring
}

void clearLEDs(){
  for(int i=0;i<NUM_LEDS;i++)
    strip.setPixelColor(i,0);
}

void handleMessage(String msg){

  clearLEDs();

  int leftRow,leftCol,rightRow,rightCol;

  if(msg.indexOf("\"left\"")>=0){
    sscanf(msg.c_str(),
      "{\"left\":[%d,%d],\"right\":[%d,%d]}",
      &leftRow,&leftCol,&rightRow,&rightCol);

    if(leftRow>=0 && leftCol>=0){
      int idx=indexFromRowCol(leftRow,leftCol);
      strip.setPixelColor(idx, strip.Color(255,0,0)); // red
    }

    if(rightRow>=0 && rightCol>=0){
      int idx=indexFromRowCol(rightRow,rightCol);
      strip.setPixelColor(idx, strip.Color(0,0,255)); // blue
    }

    strip.show();
  }
}

void onWebSocketEvent(uint8_t num,WStype_t type,uint8_t * payload,size_t length){
  if(type==WStype_TEXT){
    String msg = String((char*)payload);
    handleMessage(msg);
  }
}

void setup(){
  Serial.begin(115200);

  strip.begin();
  strip.show();

  WiFi.begin(ssid,password);
  while(WiFi.status()!=WL_CONNECTED){
    delay(500);
  }

  Serial.println(WiFi.localIP());

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);
}

void loop(){
  webSocket.loop();
}
