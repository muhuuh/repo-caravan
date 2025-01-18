import { supabase } from './supabase';
import type { Pupil, Report, Exam, Correction } from '../types/database';

export const database = {
  pupils: {
    async create(data: Omit<Pupil, 'id' | 'created_at' | 'teacher_id'>) {
      const { data: pupil, error } = await supabase
        .from('pupils')
        .insert({
          ...data,
          teacher_id: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return pupil;
    },

    async list() {
      const { data: pupils, error } = await supabase
        .from('pupils')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return pupils;
    },
  },

  reports: {
    async create(data: Omit<Report, 'id' | 'requested_at' | 'teacher_id'>) {
      const { data: report, error } = await supabase
        .from('reports')
        .insert({
          ...data,
          teacher_id: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return report;
    },

    async listByPupil(pupilId: string) {
      const { data: reports, error } = await supabase
        .from('reports')
        .select('*')
        .eq('pupil_id', pupilId)
        .order('requested_at', { ascending: false });

      if (error) throw error;
      return reports;
    },
  },

  exams: {
    async create(data: { title: string; content: string }) {
      const { data: exam, error } = await supabase
        .from('exams')
        .insert({
          ...data,
          teacher_id: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return exam;
    },

    async list() {
      const { data: exams, error } = await supabase
        .from('exams')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return exams;
    },

    async update(id: string, content: string) {
      const { data: exam, error } = await supabase
        .from('exams')
        .update({ content })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return exam;
    },

    async get(id: string) {
      const { data: exam, error } = await supabase
        .from('exams')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return exam;
    },
  },

  corrections: {
    async create(data: { content: string; exam_id: string }) {
      const { data: correction, error } = await supabase
        .from('corrections')
        .insert({
          ...data,
          teacher_id: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return correction;
    },

    async getByExamId(examId: string) {
      const { data: correction, error } = await supabase
        .from('corrections')
        .select('*')
        .eq('exam_id', examId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return correction || null;
    },

    async update(id: string, content: string) {
      const { data: correction, error } = await supabase
        .from('corrections')
        .update({ content })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return correction;
    },
  },
};