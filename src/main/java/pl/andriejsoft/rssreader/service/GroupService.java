package pl.andriejsoft.rssreader.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.document.Group;
import pl.andriejsoft.rssreader.repository.GroupRepository;

import java.util.List;
import java.util.Optional;

@Service
public class GroupService {

    @Autowired
    private GroupRepository groupRepository;

    public List<Group> findAll() {
        return groupRepository.findAll();
    }

    public Optional<Group> findById(String uuid) {
        return groupRepository.findByUuid(uuid);
    }

    public Group save(Group group) {
        return groupRepository.save(group);
    }

    public Group deleteByUuid(String uuid) {
        return groupRepository.deleteByUuid(uuid);
    }
}
