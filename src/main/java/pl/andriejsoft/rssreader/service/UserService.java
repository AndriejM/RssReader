package pl.andriejsoft.rssreader.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.document.Config;
import pl.andriejsoft.rssreader.document.User;
import pl.andriejsoft.rssreader.repository.UserRepository;

import java.util.List;
import java.util.Optional;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    public List<User> findAll() {
        return userRepository.findAll();
    }

    public Optional<User> findById(String uuid) {
        return userRepository.findByUuid(uuid);
    }

    public Optional<User> findByUserName(String userName) {
        return userRepository.findByUserName(userName);
    }

    public User save(User user) {
        return userRepository.save(user);
    }

    public User deleteByUuid(String uuid) {
        return userRepository.deleteByUuid(uuid);
    }
}
