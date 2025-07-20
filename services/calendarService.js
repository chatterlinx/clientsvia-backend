// services/calendarService.js

class CalendarService {
  constructor() {
    this.bookings = new Map();
  }

  async getAvailableSlots(tradeType, date = null) {
    // Mock available time slots based on trade type
    const baseDate = date || new Date();
    const slots = [];
    
    // Generate slots for next 7 days
    for (let day = 0; day < 7; day++) {
      const currentDate = new Date(baseDate);
      currentDate.setDate(currentDate.getDate() + day);
      
      // Skip weekends for some trade types
      if (tradeType === 'HVAC' && (currentDate.getDay() === 0 || currentDate.getDay() === 6)) {
        continue;
      }
      
      // Generate time slots (8 AM to 5 PM, 2-hour blocks)
      for (let hour = 8; hour < 17; hour += 2) {
        const start = new Date(currentDate);
        start.setHours(hour, 0, 0, 0);
        
        const end = new Date(start);
        end.setHours(hour + 2, 0, 0, 0);
        
        // Check if slot is available
        const slotKey = `${start.toISOString()}-${end.toISOString()}`;
        if (!this.bookings.has(slotKey)) {
          slots.push({
            id: slotKey,
            start: start.toISOString(),
            end: end.toISOString(),
            tradeType,
            duration: '2 hours',
            status: 'available'
          });
        }
      }
    }
    
    return slots.slice(0, 10); // Return first 10 available slots
  }

  async bookSlot(slotId, bookingData) {
    if (this.bookings.has(slotId)) {
      throw new Error('Slot already booked');
    }
    
    const booking = {
      id: slotId,
      ...bookingData,
      bookedAt: new Date().toISOString(),
      status: 'confirmed'
    };
    
    this.bookings.set(slotId, booking);
    return booking;
  }

  async cancelBooking(slotId) {
    if (!this.bookings.has(slotId)) {
      throw new Error('Booking not found');
    }
    
    this.bookings.delete(slotId);
    return { message: 'Booking cancelled successfully' };
  }

  async getBooking(slotId) {
    return this.bookings.get(slotId) || null;
  }

  async getAllBookings() {
    return Array.from(this.bookings.values());
  }
}

// Singleton instance
const calendarService = new CalendarService();

module.exports = {
  getAvailableSlots: (tradeType, date) => calendarService.getAvailableSlots(tradeType, date),
  bookSlot: (slotId, bookingData) => calendarService.bookSlot(slotId, bookingData),
  cancelBooking: (slotId) => calendarService.cancelBooking(slotId),
  getBooking: (slotId) => calendarService.getBooking(slotId),
  getAllBookings: () => calendarService.getAllBookings()
};
