Pause:
	ld a, 1
	ldh [paused], a
	xor a
	ldh [rNR52], a ; disable sound
	call draw_FadeToWhite

	; turn off screen
	vbl
	xor a
	ldh [rLCDC], a
	di

	; write bartholomew to vram
	memcpy bartholomew, $9000, 2048
	memcpy bartholomew_map, $9800, bartholomew_map_end - bartholomew_map
	xor a
	ldh [rSCX], a
	ldh [rSCY], a
	ld a, SCRN_Y
	ldh [rWY], a

	; turn screen back on
	ei
	ldh a, [lcdc]
	and LCDCF_OBJON ^ $ff
	ldh [rLCDC], a

	jp draw_FadeWhiteToPal
	; ret

Unpause:
	call draw_FadeToWhite

	vbl
	xor a
	ldh [rLCDC], a

	; write regular chr to vram
	memcpy tiles+$1000, $9000, 2048
	memcpy test_room_map, $9800, test_room_map_end - test_room_map

	; turn screen back on
	ldh a, [lcdc]
	ldh [rLCDC], a

	xor a
	ldh [paused], a
	ld a, AUDENA_ON
	ldh [rNR52], a
	ld a, $ff
	ldh [rNR51], a
	ldh [rNR50], a
	jp draw_FadeWhiteToPal
	; ret

section "bartholomew_map", romx
bartholomew_map:
	db 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,13,14,15,16,17,17,18,19,20,21,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,24,9,25,26,17,17,17,27,28,29,30,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,31,32,33,34,35,36,17,17,37,38,39,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,40,41,42,43,44,45,46,47,48,49,50,51,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,52,53,54,55,56,57,58,59,60,61,62,63,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64,65,66,67,68,69,70,71,72,73,74,75,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,76,77,78,79,80,81,82,83,84,85,39,86,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,87,88,89,90,91,92,93,94,95,96,39,97,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,98,99,100,101,102,103,104,105,106,107,39,86,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,108,109,110,111,112,113,114,115,116,117,39,86,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,118,119,120,121,122,123,124,125,126,127,39,86,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,"P" + ascii_to_tile_offs,"A" + ascii_to_tile_offs,"U" + ascii_to_tile_offs,"S" + ascii_to_tile_offs,"E" + ascii_to_tile_offs,"D" + ascii_to_tile_offs,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
bartholomew_map_end: