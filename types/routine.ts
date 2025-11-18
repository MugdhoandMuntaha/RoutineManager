export interface Routine {
    $id?: string;
    courseName: string;
    courseCode: string;
    teacherName: string;
    teacherAvatar?: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    ownerId?: string;
    createdAt?: string;
    updatedAt?: string;
}
